import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';
import { createPublicKey, KeyObject } from 'crypto';
import { SupabaseService } from '../../supabase/supabase.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ALLOW_SUSPENDED_KEY } from '../decorators/allow-suspended.decorator';
import { config } from '../../config';

interface CachedTokenUser {
  userPayload: any;
  expiresAt: number;
}

interface CachedAccountStatus {
  status: string;
  expiresAt: number;
}

/** Shape the client keys its suspension screen off. */
export const SUSPENDED_ERROR_CODE = 'ACCOUNT_SUSPENDED';

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
  private static readonly revokedUsers = new Set<string>();
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000;
  private static readonly MAX_CACHE_SIZE = 10000;
  /**
   * Account status is read per request, so it is cached briefly. The window is
   * short deliberately: a suspension should take effect in seconds, not at the
   * next login. `clearAccountStatus` drops it immediately when an admin acts.
   */
  private static readonly accountStatusCache = new Map<
    string,
    CachedAccountStatus
  >();
  private static readonly STATUS_TTL_MS = 15 * 1000;

  /** Invalidate a cached status so a suspend/unsuspend applies at once. */
  public static clearAccountStatus(userId: string): void {
    if (userId) JwtGuard.accountStatusCache.delete(userId);
  }

  /**
   * Instantly revokes all authentication tokens for a deleted/deactivated user.
   */
  public static revokeUser(userId: string): void {
    if (!userId) return;
    JwtGuard.revokedUsers.add(userId);
    for (const [token, cached] of JwtGuard.tokenCache.entries()) {
      if (cached.userPayload?.id === userId) {
        JwtGuard.tokenCache.delete(token);
      }
    }
  }

  public static isUserRevoked(userId: string): boolean {
    return JwtGuard.revokedUsers.has(userId);
  }

  // ── JWKS cache (asymmetric ES256/RS256 signing keys) ──────────────────────
  // Supabase's current signing key is asymmetric (ECC P-256 → ES256 tokens), so
  // the legacy HS256 shared secret can't verify current tokens. We fetch the
  // project's public JWKS ONCE, cache the public keys by `kid` in memory, and
  // verify every token's signature locally (zero network calls per request).
  // A cache miss on an unknown `kid` triggers a single throttled refresh (keys
  // rotate rarely), so a rotation self-heals without a redeploy.
  private static jwksKeys = new Map<string, KeyObject>();
  private static jwksLastFetch = 0;
  private static jwksInFlight: Promise<void> | null = null;
  private static warmed = false;
  private static readonly JWKS_MIN_REFRESH_MS = 5 * 60 * 1000;
  // Fixed asymmetric allowlist — the ONLY algorithms accepted on the local JWKS
  // path. Symmetric (HS*) and `none` are deliberately excluded here.
  private static readonly ASYMMETRIC_ALGS: jwt.Algorithm[] = [
    'ES256',
    'ES384',
    'ES512',
    'RS256',
    'RS384',
    'RS512',
    'PS256',
    'PS384',
    'PS512',
  ];

  /** The `iss` every Supabase token from THIS project carries. */
  private static expectedIssuer(): string | null {
    const base = config.auth.supabase.url;
    if (!base || base.includes('placeholder')) return null;
    return `${base}/auth/v1`;
  }

  private static jwksUrl(): string | null {
    const base = config.auth.supabase.url;
    if (!base || base.includes('placeholder')) return null;
    return `${base}/auth/v1/.well-known/jwks.json`;
  }

  private static async refreshJwks(force = false): Promise<void> {
    const now = Date.now();
    if (
      !force &&
      now - this.jwksLastFetch < this.JWKS_MIN_REFRESH_MS &&
      this.jwksKeys.size > 0
    )
      return;
    if (this.jwksInFlight) return this.jwksInFlight;
    const url = this.jwksUrl();
    if (!url) return;

    this.jwksInFlight = (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        const body: any = await res.json();
        const keys = Array.isArray(body?.keys) ? body.keys : [];
        const next = new Map<string, KeyObject>();
        for (const jwk of keys) {
          if (!jwk?.kid) continue;
          try {
            next.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' }));
          } catch {
            /* skip unusable key */
          }
        }
        if (next.size > 0) {
          this.jwksKeys = next;
          this.jwksLastFetch = Date.now();
        }
      } catch {
        /* network hiccup — keep existing cache, remote fallback covers gaps */
      } finally {
        this.jwksInFlight = null;
      }
    })();
    return this.jwksInFlight;
  }

  private static async getSigningKey(kid: string): Promise<KeyObject | null> {
    let key = this.jwksKeys.get(kid);
    if (key) return key;
    await this.refreshJwks(this.jwksKeys.size === 0); // force only on a cold cache
    key = this.jwksKeys.get(kid);
    if (key) return key;
    // Unknown kid with a warm-but-stale cache → one forced refresh (rotation).
    await this.refreshJwks(true);
    return this.jwksKeys.get(kid) || null;
  }

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

  constructor(
    private supabaseService: SupabaseService,
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {
    // Warm the JWKS cache once at boot so the very first authenticated request
    // doesn't pay the JWKS fetch, and log the result so it's obvious in the
    // startup logs whether local (fast) verification is active.
    if (!JwtGuard.warmed) {
      JwtGuard.warmed = true;
      const url = JwtGuard.jwksUrl();
      if (!url) {
        this.logger.warn(
          '[JwtGuard] SUPABASE_URL not set — JWKS local verification disabled, using remote auth fallback.',
        );
      } else {
        JwtGuard.refreshJwks(true)
          .then(() => {
            const n = JwtGuard.jwksKeys.size;
            if (n > 0) {
              this.logger.log(
                `[JwtGuard] Loaded ${n} JWKS signing key(s) — local (0-network) token verification ACTIVE.`,
              );
            } else {
              this.logger.warn(
                `[JwtGuard] JWKS fetch returned no keys from ${url} — falling back to remote auth.`,
              );
            }
          })
          .catch((e) =>
            this.logger.warn(
              `[JwtGuard] JWKS warm failed (${(e as Error).message}) — remote auth fallback in use.`,
            ),
          );
      }
    }
  }

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
      throw new UnauthorizedException(
        'Supabase Auth is not configured on this server',
      );
    }

    const userPayload = await this.validateToken(token);
    if (!userPayload) {
      throw new UnauthorizedException(
        'Invalid or expired authentication token',
      );
    }

    if (userPayload.id && JwtGuard.isUserRevoked(userPayload.id)) {
      throw new UnauthorizedException(
        'Account has been deleted or deactivated',
      );
    }

    // Suspension is enforced here, not on the screen the client chooses to
    // render. A suspended account keeps a working session by design so it can
    // be told what happened and appeal, but every route that is not explicitly
    // marked `@AllowSuspended()` is refused server-side.
    await this.enforceAccountStatus(context, userPayload);

    request.user = userPayload;
    return true;
  }

  /**
   * Refuses a suspended account on everything except the suspension flow.
   *
   * The thrown error carries a machine-readable `code` so the client can show
   * the suspension screen instead of a generic error toast. BANNED and DELETED
   * are handled earlier at sign-in and stay fully blocked — a ban is not
   * appealable through this route.
   */
  private async enforceAccountStatus(
    context: ExecutionContext,
    userPayload: any,
  ): Promise<void> {
    const userId = userPayload?.id;
    if (!userId) return;

    const allowed = this.reflector.getAllAndOverride<boolean>(
      ALLOW_SUSPENDED_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (allowed) return;

    const status = await this.resolveAccountStatus(userId);
    if (status === 'SUSPENDED') {
      throw new ForbiddenException({
        code: SUSPENDED_ERROR_CODE,
        message:
          'This account is suspended. You can request a review from the suspension screen.',
      });
    }
  }

  /** Cached account-status read, so this costs one query per user per window. */
  private async resolveAccountStatus(userId: string): Promise<string | null> {
    const now = Date.now();
    const cached = JwtGuard.accountStatusCache.get(userId);
    if (cached && cached.expiresAt > now) return cached.status;

    try {
      const row = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { accountStatus: true },
      });
      const status = row?.accountStatus ?? null;
      if (status) {
        JwtGuard.accountStatusCache.set(userId, {
          status,
          expiresAt: now + JwtGuard.STATUS_TTL_MS,
        });
      }
      return status;
    } catch (error) {
      // Never fail an authenticated request because the status lookup broke;
      // the gate is a restriction, and a database blip must not lock everyone
      // out of the app.
      this.logger.warn(
        `account-status lookup failed user=${userId} error=${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Validates the token and returns a normalized user payload, or null if the
   * token is invalid/expired. Never trusts an unverified payload.
   */
  public async validateToken(token: string): Promise<any | null> {
    const now = Date.now();
    const cached = JwtGuard.tokenCache.get(token);
    if (cached && cached.expiresAt > now) {
      return cached.userPayload;
    }
    if (cached) {
      // Expired cache entry — drop it and re-validate.
      JwtGuard.tokenCache.delete(token);
    }

    const header = this.parseHeader(token);
    const alg = header?.alg;

    const normalize = (payload: any) => {
      const userId = payload.sub || payload.id || payload.user_id;
      if (!userId) return null;
      const normalizedPayload = {
        id: userId,
        email: payload.email || `${userId}@meetifyy.user`,
        user_metadata:
          payload.user_metadata || payload.raw_user_meta_data || {},
        // Not present in Supabase access tokens — auth.service resolves it via
        // the admin API on the new-account path when needed.
        email_confirmed_at: payload.email_confirmed_at,
        confirmed_at: payload.confirmed_at,
        token,
      };

      const tokenExp = this.parseExp(token);
      const expiresAt = tokenExp
        ? Math.min(tokenExp * 1000, now + JwtGuard.CACHE_TTL_MS)
        : now + JwtGuard.CACHE_TTL_MS;
      JwtGuard.setCache(token, { userPayload: normalizedPayload, expiresAt });

      return normalizedPayload;
    };

    // Fast path 1: asymmetric tokens (ES256/RS256) — Supabase's current signing
    // scheme. Verify locally against the cached JWKS public key (no per-request
    // network). This is what makes authenticated requests ~0ms in steady state.
    //
    // SECURITY: the `algorithms` allowlist is FIXED server-side to asymmetric
    // algorithms only — it is NEVER derived from the attacker-controlled header.
    // That closes the algorithm-confusion / `alg:none` / RS→HS downgrade class
    // (an attacker knows the public key, so accepting HS256 here would let them
    // forge tokens by HMAC-ing with it). We also pin the issuer to THIS project.
    if (
      header?.kid &&
      alg &&
      JwtGuard.ASYMMETRIC_ALGS.includes(alg as jwt.Algorithm)
    ) {
      try {
        const key = await JwtGuard.getSigningKey(header.kid);
        if (key) {
          const issuer = JwtGuard.expectedIssuer();
          const payload: any = jwt.verify(token, key, {
            algorithms: JwtGuard.ASYMMETRIC_ALGS,
            ...(issuer ? { issuer } : {}),
          });
          return normalize(payload);
        }
      } catch (e) {
        if (e instanceof jwt.TokenExpiredError) return null;
        this.logger.warn(
          `Local JWKS verify failed (${(e as Error).message}); falling back to remote`,
        );
      }
    }

    // Fast path 2: legacy HS256 shared secret, if the project still issues HS256.
    const secret = config.auth.supabase.jwtSecret;
    if (secret && alg === 'HS256') {
      try {
        const payload: any = jwt.verify(token, secret, {
          algorithms: ['HS256'],
        });
        return normalize(payload);
      } catch (e) {
        if (e instanceof jwt.TokenExpiredError) return null;
        this.logger.warn(
          `Local HS256 verify failed (${(e as Error).message}); falling back to remote validation`,
        );
      }
    }

    // Fallback: authoritative remote validation against Supabase Auth.
    try {
      const { data, error } =
        await this.supabaseService.client.auth.getUser(token);
      if (error || !data?.user) {
        return null;
      }
      const user = data.user;
      const normalizedPayload = {
        id: user.id,
        email: user.email || `${user.id}@meetifyy.user`,
        user_metadata: user.user_metadata || {},
        email_confirmed_at: (user as any).email_confirmed_at,
        confirmed_at: (user as any).confirmed_at,
        token,
      };

      const tokenExp = this.parseExp(token);
      const expiresAt = tokenExp
        ? Math.min(tokenExp * 1000, now + JwtGuard.CACHE_TTL_MS)
        : now + JwtGuard.CACHE_TTL_MS;
      JwtGuard.setCache(token, { userPayload: normalizedPayload, expiresAt });

      return normalizedPayload;
    } catch (e) {
      this.logger.warn(`Token validation error: ${(e as Error).message}`);
      return null;
    }
  }

  /** Reads the JOSE header ({alg, kid}) to route verification. Not trusted for auth. */
  private parseHeader(token: string): { alg?: string; kid?: string } | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      return JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf-8'));
    } catch {
      return null;
    }
  }

  /** Reads the `exp` claim without trusting it for auth — used only to tune cache TTL. */
  private parseExp(token: string): number | undefined {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return undefined;
      const decoded = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString('utf-8'),
      );
      return typeof decoded?.exp === 'number' ? decoded.exp : undefined;
    } catch {
      return undefined;
    }
  }
}
