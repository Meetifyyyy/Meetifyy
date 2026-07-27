import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { CACHE_CONTROL_KEY } from '../decorators/cache-control.decorator';

@Injectable()
export class NoCacheInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp();
    const response = ctx.getResponse();

    // Read the @CacheControl() value from the route handler or controller.
    // Falls back to 'no-store' so any undecorated route is safe by default.
    const cacheControl =
      this.reflector.getAllAndOverride<string>(CACHE_CONTROL_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'no-store, no-cache, must-revalidate, proxy-revalidate';

    response.setHeader('Cache-Control', cacheControl);
    if (cacheControl.includes('no-store')) {
      response.setHeader('Pragma', 'no-cache');
      response.setHeader('Expires', '0');
    }

    return next.handle();
  }
}

