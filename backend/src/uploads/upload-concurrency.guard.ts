import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Response } from 'express';

/**
 * How many pass-through uploads one process will have in flight at once.
 *
 * WHY A GUARD, NOT A LOCK AROUND THE HANDLER
 * The multipart body is read into memory by FileInterceptor, which runs before
 * the handler: by the time handler code could take a lock, the megabytes are
 * already buffered. A guard runs ahead of the interceptor, so a request that is
 * refused here never has its body read at all.
 *
 * WHY EIGHT
 * Each slot can hold up to the 50 MB multer ceiling, so eight is at most
 * ~400 MB in the worst case on a container shared with the rest of the API,
 * while the images that actually take this path are a few MB each. It is a
 * fallback route (the client uploads straight to storage first), so ordinary
 * traffic is nowhere near it; the cap exists to bound what a burst or a
 * handful of slow connections can pin.
 */
export const UPLOAD_MAX_CONCURRENT = 8;

/** Seconds a refused caller is told to wait before retrying. */
export const UPLOAD_BUSY_RETRY_AFTER_SECONDS = 5;

/**
 * Admits at most UPLOAD_MAX_CONCURRENT requests at a time, per process, and
 * answers the rest immediately with 503 and Retry-After. There is no queue: a
 * waiting request would hold its socket and its place, and the client already
 * has its own retry behaviour.
 *
 * Mount after JwtGuard and RateLimitPolicyGuard so an anonymous or over-budget
 * caller never takes a slot.
 */
@Injectable()
export class UploadConcurrencyGuard implements CanActivate {
  private readonly logger = new Logger(UploadConcurrencyGuard.name);
  private inFlight = 0;

  canActivate(context: ExecutionContext): boolean {
    const res = context.switchToHttp().getResponse<Response>();

    if (this.inFlight >= UPLOAD_MAX_CONCURRENT) {
      this.logger.warn(`upload.busy inFlight=${this.inFlight}`);
      // Set here because the no-cache interceptor only runs for requests that
      // pass the guards; without it a shared cache could keep serving "busy"
      // for a request that would succeed a moment later.
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Retry-After', String(UPLOAD_BUSY_RETRY_AFTER_SECONDS));
      throw new ServiceUnavailableException(
        'Uploads are busy right now. Please try again in a few seconds.',
      );
    }

    this.inFlight += 1;
    // `close` fires once per response, after `finish` on a normal completion
    // and on its own when the client disconnects mid-upload, so the slot is
    // returned on every path including an error thrown by a later step.
    let released = false;
    res.once('close', () => {
      if (released) return;
      released = true;
      this.inFlight -= 1;
    });
    return true;
  }
}
