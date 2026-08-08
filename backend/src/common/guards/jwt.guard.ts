import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { SupabaseService } from '../../supabase/supabase.service';

interface CachedTokenUser {
  userPayload: any;
  expiresAt: number;
}

/**
 * Authenticates requests bearing a Supabase-issued JWT.
 *
 * SECURITY: The token signature MUST be verified. A previous implementation
 * only base64-decoded the payload and trusted `sub`, which let anyone forge a
 * token for any user id — a full authentication bypass.
 *
 * Two validation modes, both cryptographically sound:
 *   1. Local (preferred): if SUPABASE_JWT_SECRET is configured, verify the HS256
 *      signature in-process with zero network calls (~0ms).
 *   2. Remote (fallback): otherwise call `supabase.auth.getUser(token)` — the
 *      same authoritative path the realtime gateway uses; Supabase verifies the
 *      signature/expiry server-side and returns `email_confirmed_at`.
 *
 * Supabase access-token JWTs do not carry `email_confirmed_at`, so in local mode
 * that field is absent from the payload — the sync security gate in
 * auth.service.ts resolves it via the admin API only on the new-account path.
 *
 * Verified results are cached in-memory per token (5-min TTL, bounded size), so
 * validation runs at most once per token per window and steady-state latency
 * stays effectively zero.
 */
@Injectable()
export class JwtGuard implements CanActivate {
  private readonly logger = new Logger(JwtGuard.name);
  private static readonly tokenCache = new Map<string, CachedTokenUser>();
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000;
  private static readonly MAX_CACHE_SIZE = 10000;

  private static setCache(token: string, entry: CachedTokenUser) {
    if (this.tokenCache.size >= this.MAX_CACHE_SIZE) {
      const now = Date.now();
      for (const [k, v] of this.tokenCache.entries()) {
        if (v.expiresAt <= now) {
          this.tokenCache.delete(k);
        }
      }
      if (this.tokenCache.size >= this.MAX_CACHE_SIZE) {
        const firstKey = this.tokenCache.keys().next().value;
        if (firstKey) this.tokenCache.delete(firstKey);
      }
    }
    this.tokenCache.set(token, entry);
  }

  constructor(private supabaseService: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      throw new UnauthorizedException('Missing authorization header');
    }

    const token = authHeader.replace('Bearer ', '').trim();
    if (!token) {
      throw new UnauthorizedException('Missing authorization header');
    }

    if (!this.supabaseService.isConfigured) {
      throw new UnauthorizedException('Supabase Auth is not configured on this server');
    }

    const now = Date.now();
    const cached = JwtGuard.tokenCache.get(token);
    if (cached && cached.expiresAt > now) {
      request.user = cached.userPayload;
      return true;
    }
    if (cached) {
      // Expired cache entry — drop it and re-validate.
      JwtGuard.tokenCache.delete(token);
    }

    const userPayload = await this.validateToken(token);
    if (!userPayload) {
      throw new UnauthorizedException('Invalid or expired authentication token');
    }

    // Cache until the token's own expiry, capped by the guard TTL so revoked
    // sessions are re-checked at least every CACHE_TTL_MS.
    const tokenExp = this.parseExp(token);
    const expiresAt = tokenExp
      ? Math.min(tokenExp * 1000, now + JwtGuard.CACHE_TTL_MS)
      : now + JwtGuard.CACHE_TTL_MS;
    JwtGuard.setCache(token, { userPayload, expiresAt });

    request.user = userPayload;
    return true;
  }

  /**
   * Validates the token and returns a normalized user payload, or null if the
   * token is invalid/expired. Never trusts an unverified payload.
   */
  private async validateToken(token: string): Promise<any | null> {
    const secret = process.env.SUPABASE_JWT_SECRET;

    // Fast path: local HS256 signature verification (no network) when configured.
    if (secret) {
      try {
        const payload: any = jwt.verify(token, secret, { algorithms: ['HS256'] });
        const userId = payload.sub || payload.id || payload.user_id;
        if (!userId) return null;
        return {
          id: userId,
          email: payload.email || `${userId}@meetifyy.user`,
          user_metadata: payload.user_metadata || payload.raw_user_meta_data || {},
          // Not present in Supabase access tokens — auth.service resolves it via
          // the admin API on the new-account path when needed.
          email_confirmed_at: payload.email_confirmed_at,
          confirmed_at: payload.confirmed_at,
          token,
        };
      } catch (e) {
        // A genuinely expired token is a hard failure — reject.
        if (e instanceof jwt.TokenExpiredError) return null;
        // Any other failure (wrong secret, or the project uses asymmetric signing
        // keys instead of the legacy HS256 secret) must NOT lock everyone out.
        // Degrade to the authoritative remote path below instead of failing closed.
        this.logger.warn(
          `Local JWT verify failed (${(e as Error).message}); falling back to remote validation`,
        );
      }
    }

    // Fallback: authoritative remote validation against Supabase Auth.
    try {
      const { data, error } = await this.supabaseService.client.auth.getUser(token);
      if (error || !data?.user) {
        return null;
      }
      const user = data.user;
      return {
        id: user.id,
        email: user.email || `${user.id}@meetifyy.user`,
        user_metadata: user.user_metadata || {},
        email_confirmed_at: (user as any).email_confirmed_at,
        confirmed_at: (user as any).confirmed_at,
        token,
      };
    } catch (e) {
      this.logger.warn(`Token validation error: ${(e as Error).message}`);
      return null;
    }
  }

  /** Reads the `exp` claim without trusting it for auth — used only to tune cache TTL. */
  private parseExp(token: string): number | undefined {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return undefined;
      const decoded = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
      return typeof decoded?.exp === 'number' ? decoded.exp : undefined;
    } catch {
      return undefined;
    }
  }
}
