import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { httpLine, LOG_CAUSE } from '../logging/log-format';

const SENSITIVE_FIELDS = new Set([
  'password', 'newpassword', 'confirmpassword', 'accesstoken', 'refreshtoken', 
  'authorization', 'cookie', 'otp', 'verificationcode', 'secret', 'apikey', 'token'
]);

function redact(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(redact);
  
  const copy = { ...obj };
  for (const key of Object.keys(copy)) {
    if (SENSITIVE_FIELDS.has(key.toLowerCase())) {
      copy[key] = '[REDACTED]';
    } else if (typeof copy[key] === 'object') {
      copy[key] = redact(copy[key]);
    }
  }
  return copy;
}


/**
 * Unwrap the thing that actually went wrong.
 *
 * A 500 reports `message` as the generic "Internal server error" the client is
 * given, so the log line said nothing about the cause and you had to read the
 * stack to find it. The real message goes on the line itself.
 */
function rootCause(exception: unknown): string {
  if (exception instanceof Error && exception.message) {
    // Prisma renders a multi-line message with the offending call and a code
    // frame. The last non-empty line is the actual complaint
    // ("The column `x` does not exist in the current database.").
    const lines = exception.message.split('\n').map((l) => l.trim()).filter(Boolean);
    return lines[lines.length - 1] || exception.message;
  }
  return String(exception);
}

/**
 * Keep only this project's frames. A raw stack is ~15 lines of node_modules
 * and node internals wrapped around the two or three frames that locate the
 * bug; those are the ones worth printing.
 */
function appStack(exception: unknown, limit = 3): string {
  if (!(exception instanceof Error) || !exception.stack) return '';
  const frames = exception.stack
    .split('\n')
    .filter((l) => l.includes('/src/') && !l.includes('node_modules'))
    .slice(0, limit)
    .map((l) => l.trim().replace(/^at\s+/, '  at '));
  return frames.join('\n');
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    let bodySnippet = '';
    if (request.body && Object.keys(request.body).length > 0) {
      bodySnippet = `body=${JSON.stringify(redact(request.body))}`;
    }

    const cause = status >= 500
      ? rootCause(exception)
      : (typeof message === 'object' ? JSON.stringify(redact(message)) : String(message));

    if (status >= 500) {
      // 5xx is logged here because this is the only place with the stack.
      // pino-http's own response line is demoted to debug so this is the sole
      // entry, which is why the latency is absent — it is not known yet.
      this.logger.error(
        httpLine({
          method: request.method,
          url: request.url,
          status,
          userId: (request as any).user?.id,
          reqId: (request as any).id,
          extra: bodySnippet,
          cause,
        }),
        appStack(exception),
      );
    } else {
      // 4xx does NOT log here. Doing so printed two lines for every rejected
      // request — this one with the cause but no latency, and pino-http's with
      // the latency but no cause. Handing the cause over lets pino-http emit a
      // single complete line once the response is finished.
      (request as any)[LOG_CAUSE] = cause;
    }

    // Format safe response structure.
    //
    // A machine-readable `code` is passed through when the thrown exception
    // carries one (e.g. the activity access policy's COLLEGE_RESTRICTED /
    // PRIVATE), so clients can pick the right UI state without parsing the
    // human-readable message. Nothing else from the thrown body is echoed.
    const errorCode =
      typeof message === 'object' && message !== null && typeof (message as any).code === 'string'
        ? (message as any).code
        : undefined;

    const errorResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message:
        typeof message === 'object' && 'message' in message
          ? (message as any).message
          : message,
      ...(errorCode ? { code: errorCode } : {}),
    };

    if (response.headersSent) {
      return;
    }

    response.status(status).json(errorResponse);
  }
}
