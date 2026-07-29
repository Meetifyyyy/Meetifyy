import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';

interface CachedTokenUser {
  userPayload: any;
  expiresAt: number;
}

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

    if (!this.supabaseService.isConfigured) {
      throw new UnauthorizedException('Supabase Auth is not configured on this server');
    }

    const now = Date.now();
    const cached = JwtGuard.tokenCache.get(token);
    if (cached && cached.expiresAt > now) {
      request.user = cached.userPayload;
      return true;
    }

    // Fast local JWT parsing & zero-remote-network validation (0ms overhead)
    try {
      const parts = token.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
        const nowSec = Math.floor(now / 1000);
        const userId = payload.sub || payload.id || payload.user_id;

        if (payload && userId) {
          if (payload.exp && payload.exp <= nowSec) {
            throw new UnauthorizedException('Invalid or expired authentication token');
          }

          const userPayload = {
            id: userId,
            email: payload.email || `${userId}@meetifyy.user`,
            user_metadata: payload.user_metadata || {},
            token,
          };

          const expiresAt = payload.exp ? payload.exp * 1000 : now + JwtGuard.CACHE_TTL_MS;
          JwtGuard.setCache(token, {
            userPayload,
            expiresAt,
          });

          request.user = userPayload;
          return true;
        }
      }
    } catch (e) {
      if (e instanceof UnauthorizedException) {
        throw e;
      }
    }

    throw new UnauthorizedException('Invalid or expired authentication token');
  }
}
