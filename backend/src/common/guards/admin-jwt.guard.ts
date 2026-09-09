import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import * as jwt from 'jsonwebtoken';
import { config } from '../../config';
import { timingSafeEqual } from 'crypto';

@Injectable()
export class AdminJwtGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // 1. Extract access token from HttpOnly cookie or Authorization header
    let token = request.cookies?.admin_access;
    if (!token && request.headers.authorization) {
      token = request.headers.authorization.replace('Bearer ', '').trim();
    }

    if (!token) {
      throw new UnauthorizedException('Super Admin authentication required');
    }

    // 2. Verify JWT signature
    const secret = config.auth.admin.accessSecret;
    if (!secret) {
      throw new UnauthorizedException(
        'ADMIN_JWT_ACCESS_SECRET is missing in server environment',
      );
    }

    let payload: any;
    try {
      payload = jwt.verify(token, secret);
    } catch {
      throw new UnauthorizedException('Invalid or expired admin session token');
    }

    if (!payload || !payload.sub || !payload.sessionId) {
      throw new UnauthorizedException('Malformed token payload');
    }

    // 3. Verify Admin & Session Liveness in DB
    const [admin, session] = await Promise.all([
      this.prisma.superAdmin.findUnique({
        where: { id: payload.sub },
        select: {
          id: true,
          email: true,
          name: true,
          isActive: true,
          totpEnabled: true,
        },
      }),
      this.prisma.superAdminSession.findUnique({
        where: { id: payload.sessionId },
        select: { id: true, revoked: true, expiresAt: true, adminId: true },
      }),
    ]);

    if (!admin || !admin.isActive) {
      throw new ForbiddenException('Super Admin account disabled or invalid');
    }

    if (!session || session.revoked || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Admin session revoked or expired');
    }

    // 4. Validate CSRF token on mutating requests (POST, PUT, PATCH, DELETE)
    const method = request.method?.toUpperCase();
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      const csrfHeader = request.headers['x-csrf-token'];
      const csrfCookie = request.cookies?.admin_csrf;

      if (
        !csrfCookie ||
        typeof csrfHeader !== 'string' ||
        !constantTimeEquals(csrfHeader, csrfCookie)
      ) {
        throw new ForbiddenException('CSRF validation failed');
      }
    }

    // 5. Attach admin info to request
    request.admin = admin;
    request.adminSession = session;

    // Update lastActiveAt in background (non-blocking)
    this.prisma.superAdminSession
      .update({
        where: { id: session.id },
        data: { lastActiveAt: new Date() },
      })
      .catch(() => {});

    return true;
  }
}

/**
 * Compares two CSRF tokens without leaking their contents through timing.
 *
 * `!==` on strings returns as soon as it finds a differing byte. That is a weak
 * oracle here — the attacker must already be able to read the response — but the
 * token is a plain secret compared on every mutating admin request, and a
 * constant-time compare costs nothing. The length check is deliberately outside
 * the timing-safe path: `timingSafeEqual` throws on a length mismatch, and the
 * length of a fixed-format token is not the secret.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
