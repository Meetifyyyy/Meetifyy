import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { createPublicKey, KeyObject } from 'crypto';
import { SupabaseService } from '../../supabase/supabase.service';
import { config } from '../../config';

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

  constructor(private supabaseService: SupabaseService) {
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
      throw new UnauthorizedException(
        'Invalid or expired authentication token',
      );
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
    const header = this.parseHeader(token);
    const alg = header?.alg;

    const normalize = (payload: any) => {
      const userId = payload.sub || payload.id || payload.user_id;
      if (!userId) return null;
      return {
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
