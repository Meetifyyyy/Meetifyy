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
import { clientIp } from '../../common/rate-limit/client-ip.util';

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
    if (
      url.includes('/admin/auth/login') ||
      url.includes('/admin/auth/refresh') ||
      url.includes('/admin/auth/verify-otp')
    ) {
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
        else if (url.includes('/admin/content')) targetType = 'CONTENT';
        else if (url.includes('/admin/verification'))
          targetType = 'VERIFICATION';
        // Checked before the generic '/admin/users' branch would ever see it,
        // and given its own type so a restore or a forced purge is
        // distinguishable in the audit log from an ordinary user edit.
        else if (url.includes('/admin/account-deletion'))
          targetType = 'ACCOUNT_DELETION';
        // Legal documents get their own type rather than falling into SYSTEM:
        // publishing a policy and changing a feature flag are not the same
        // kind of event, and a compliance review reads this column first.
        else if (url.includes('/admin/legal')) targetType = 'LEGAL_DOCUMENT';

        if (
          !targetId &&
          responseData &&
          (responseData.id || responseData.key)
        ) {
          targetId = responseData.id || responseData.key;
        }

        // `/admin/legal/documents/TERMS_OF_SERVICE/publish` — the route param
        // is named `type`, so the generic `params.id` lookup above misses it,
        // and the response id is a uuid nobody can read. The document type is
        // what makes the entry legible.
        if (targetType === 'LEGAL_DOCUMENT' && params.type) {
          targetId = String(params.type);
        }

        // Infer Action Name
        let action = `${targetType}_${method}`;
        if (url.includes('/suspend')) action = 'USER_SUSPEND';
        else if (url.includes('/unsuspend')) action = 'USER_UNSUSPEND';
        else if (url.includes('/restore')) action = 'USER_RESTORE';
        else if (url.includes('/reset-college')) action = 'USER_RESET_COLLEGE';
        else if (url.includes('/force-logout')) action = 'USER_FORCE_LOGOUT';
        else if (url.includes('/campus-rep')) action = 'USER_SET_CAMPUS_REP';
        // Checked before the generic `/status` rule below, which would
        // otherwise flatten an identity decision into VERIFICATION_STATUS_CHANGE
        // and lose which way it went.
        else if (targetType === 'VERIFICATION' && url.includes('/status')) {
          const decided = String(body?.status || '').toUpperCase();
          action =
            decided === 'VERIFIED'
              ? 'VERIFICATION_APPROVE'
              : decided === 'REJECTED'
                ? 'VERIFICATION_REJECT'
                : decided === 'RESUBMISSION_REQUIRED'
                  ? 'VERIFICATION_REQUEST_RESUBMISSION'
                  : 'VERIFICATION_STATUS_CHANGE';
        } else if (url.includes('/status'))
          action = `${targetType}_STATUS_CHANGE`;
        else if (url.includes('/domains')) action = 'COLLEGE_DOMAIN_CHANGE';
        else if (url.includes('/reply')) action = 'SUPPORT_TICKET_REPLY';
        // Legal actions are named individually because "what happened to the
        // Terms" is the question this log gets asked, and LEGAL_DOCUMENT_POST
        // answers none of it. Whether acceptance was made mandatory is part of
        // the row already — it is in `newValue.requiresAcknowledgement`, the
        // publish body — so enabling and disabling the requirement is auditable
        // without a separate action name.
        else if (targetType === 'LEGAL_DOCUMENT') {
          if (url.includes('/publish')) action = 'LEGAL_VERSION_PUBLISH';
          else if (url.includes('/rollback')) action = 'LEGAL_VERSION_ROLLBACK';
          else if (url.includes('/draft')) {
            action =
              method === 'DELETE'
                ? 'LEGAL_DRAFT_DELETE'
                : method === 'PUT'
                  ? 'LEGAL_DRAFT_EDIT'
                  : 'LEGAL_DRAFT_CREATE';
          } else if (url.includes('/preview')) {
            // Renders nothing and stores nothing. Logging it would bury the
            // decisions under keystrokes.
            return;
          }
        }

        // Sanitize body (strip passwords or tokens if any)
        const sanitizedBody = { ...body };
        delete sanitizedBody.password;
        delete sanitizedBody.otp;
        delete sanitizedBody.totpCode;
        // A reviewer's note can quote what they saw on an identity document.
        // The decision and who made it are what an audit trail needs; the
        // note's contents are not, and this row is read back into an admin
        // list view. The reason itself is still stored on the request row.
        if (targetType === 'VERIFICATION') delete sanitizedBody.adminNotes;
        // A legal draft body is the whole document — up to 200KB of HTML, saved
        // repeatedly while it is being written. The version row already stores
        // every byte of it under a version number this entry names, so copying
        // it here would bloat the audit table without adding a fact. The change
        // summary, the effective date and the acknowledgement switch stay.
        if (targetType === 'LEGAL_DOCUMENT') delete sanitizedBody.content;

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
              ip:
                clientIp(req) || req.ip ||
                '0.0.0.0',
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
