import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response, Request } from 'express';

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

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

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

    const reqId = (request as any).id ? `req=${(request as any).id} ` : '';
    let bodySnippet = '';
    if (request.body && Object.keys(request.body).length > 0) {
      bodySnippet = ` - Body: ${JSON.stringify(redact(request.body))}`;
    }

    const userId = (request as any).user?.id ? ` user=${(request as any).user.id}` : '';

    // Log the error
    this.logger.error(
      `[HTTP] ${request.method} ${request.url} ${status} ${reqId}${userId}${bodySnippet} - Error: ${
        typeof message === 'object' ? JSON.stringify(redact(message)) : message
      }`,
      exception instanceof Error ? exception.stack : '',
    );

    // Format safe response structure
    const errorResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message:
        typeof message === 'object' && 'message' in message
          ? (message as any).message
          : message,
    };

    response.status(status).json(errorResponse);
  }
}
