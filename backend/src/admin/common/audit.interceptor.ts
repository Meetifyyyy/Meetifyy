import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const method = req.method?.toUpperCase();

    // Only log mutating operations (POST, PUT, PATCH, DELETE) for authenticated admins
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return next.handle();
    }

    // Skip auth endpoints like login/refresh to prevent logging passwords/tokens
    const url = req.originalUrl || req.url || '';
    if (url.includes('/admin/auth/login') || url.includes('/admin/auth/refresh') || url.includes('/admin/auth/verify-otp')) {
      return next.handle();
    }

    return next.handle().pipe(
      tap((responseData) => {
        const admin = req.admin;
        if (!admin || !admin.id) return;

        const params = req.params || {};
        const body = req.body || {};

        // Infer targetType & targetId
        let targetType = 'SYSTEM';
        let targetId = params.id || params.key || null;

        if (url.includes('/admin/colleges')) targetType = 'COLLEGE';
        else if (url.includes('/admin/users')) targetType = 'USER';
        else if (url.includes('/admin/reports')) targetType = 'REPORT';
        else if (url.includes('/admin/support')) targetType = 'SUPPORT_TICKET';
        else if (url.includes('/admin/flags')) targetType = 'FEATURE_FLAG';
        else if (url.includes('/admin/settings')) targetType = 'SYSTEM_SETTING';
        else if (url.includes('/admin/content')) targetType = 'CONTENT';

        if (!targetId && responseData && (responseData.id || responseData.key)) {
          targetId = responseData.id || responseData.key;
        }

        // Infer Action Name
        let action = `${targetType}_${method}`;
        if (url.includes('/suspend')) action = 'USER_SUSPEND';
        else if (url.includes('/unsuspend')) action = 'USER_UNSUSPEND';
        else if (url.includes('/restore')) action = 'USER_RESTORE';
        else if (url.includes('/verify-email')) action = 'USER_VERIFY_EMAIL';
        else if (url.includes('/reset-college')) action = 'USER_RESET_COLLEGE';
        else if (url.includes('/capabilities')) action = 'USER_UPDATE_CAPABILITIES';
        else if (url.includes('/force-logout')) action = 'USER_FORCE_LOGOUT';
        else if (url.includes('/status')) action = `${targetType}_STATUS_CHANGE`;
        else if (url.includes('/domains')) action = 'COLLEGE_DOMAIN_CHANGE';
        else if (url.includes('/reply')) action = 'SUPPORT_TICKET_REPLY';

        // Sanitize body (strip passwords or tokens if any)
        const sanitizedBody = { ...body };
        delete sanitizedBody.password;
        delete sanitizedBody.otp;
        delete sanitizedBody.totpCode;

        // Async write to AuditLog (non-blocking)
        this.prisma.auditLog
          .create({
            data: {
              adminId: admin.id,
              action,
              targetType,
              targetId: targetId ? String(targetId) : null,
              oldValue: Prisma.JsonNull,
              newValue: sanitizedBody,
              ip: (req.headers['x-forwarded-for'] as string) || req.ip || '0.0.0.0',
              endpoint: url,
              httpMethod: method,
              requestId: (req.headers['x-request-id'] as string) || null,
            },
          })
          .catch(() => {});
      }),
    );
  }
}
