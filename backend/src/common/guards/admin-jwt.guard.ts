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
    const secret = this.configService.get<string>('ADMIN_JWT_ACCESS_SECRET');
    if (!secret) {
      throw new UnauthorizedException('ADMIN_JWT_ACCESS_SECRET is missing in server environment');
    }

    let payload: any;
    try {
      payload = jwt.verify(token, secret);
    } catch (err) {
      throw new UnauthorizedException('Invalid or expired admin session token');
    }

    if (!payload || !payload.sub || !payload.sessionId) {
      throw new UnauthorizedException('Malformed token payload');
    }

    // 3. Verify Admin & Session Liveness in DB
    const [admin, session] = await Promise.all([
      this.prisma.superAdmin.findUnique({
        where: { id: payload.sub },
        select: { id: true, email: true, name: true, isActive: true, totpEnabled: true },
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

      if (csrfCookie && csrfHeader !== csrfCookie) {
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
