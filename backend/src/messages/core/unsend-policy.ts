import { BadRequestException } from '@nestjs/common';

/**
 * How long after it was sent a message may be unsent.
 *
 * The clock that counts is the server's: `Message.createdAt` is stamped when
 * the server accepted the message (never from anything the client sends), and
 * "now" is the server's time when the unsend request is processed. A message
 * composed offline counts from when it reached the server, not from when it was
 * typed. A device's clock plays no part, so a phone set an hour back cannot
 * stretch the window.
 *
 * The boundary is inclusive: a request processed at exactly 15:00.000 after
 * acceptance is allowed, one at 15:00.001 is refused.
 */
export const UNSEND_WINDOW_MS = 15 * 60 * 1000;

/** The machine-readable refusal, so a client can say why rather than "failed". */
export const UNSEND_WINDOW_EXPIRED = 'UNSEND_WINDOW_EXPIRED';

/** The oldest `createdAt` that may still be unsent at `now`. */
export function unsendCutoff(now: Date): Date {
  return new Date(now.getTime() - UNSEND_WINDOW_MS);
}

export function isWithinUnsendWindow(createdAt: Date, now: Date): boolean {
  return now.getTime() - createdAt.getTime() <= UNSEND_WINDOW_MS;
}

/** The last moment `createdAt` may be unsent, sent to clients as a hint. */
export function unsendableUntil(createdAt: Date): Date {
  return new Date(createdAt.getTime() + UNSEND_WINDOW_MS);
}

export function unsendWindowExpiredError(): BadRequestException {
  return new BadRequestException({
    code: UNSEND_WINDOW_EXPIRED,
    message: 'Messages can only be unsent within 15 minutes of sending',
  });
}
