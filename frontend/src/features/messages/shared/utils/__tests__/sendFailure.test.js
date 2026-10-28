import { describe, it, expect } from 'vitest';
import { describeSendFailure, sendFailureReason } from '../sendFailure';
import { canOfferUnsend, unsendErrorMessage, UNSEND_WINDOW_MS } from '../unsendWindow';

const httpError = (status, code) => Object.assign(new Error('x'), { status, ...(code ? { code } : {}) });

describe('sendFailureReason: what went wrong, from what the server said', () => {
  it.each([
    ['a socket refusal because the sender was removed', { status: 'error', code: 'REJECTED', errorCode: 'NOT_A_MEMBER' }, 'not-member'],
    ['the same over REST', httpError(403, 'NOT_A_MEMBER'), 'not-member'],
    ['a deleted partner', httpError(403, 'RECIPIENT_UNAVAILABLE'), 'unavailable'],
    ['an expired sign-in', httpError(401), 'auth'],
    ['a rate limit over REST', httpError(429, 'rate_limited'), 'rate-limited'],
    ['a rate limit over the socket', { status: 'error', code: 'RATE_LIMITED' }, 'rate-limited'],
    ['a refusal with no reason given (an older server)', { status: 'error', code: 'REJECTED' }, 'refused'],
    ['a request that never reached the server', new Error('Failed to fetch'), 'network'],
    ['a server error', httpError(500), 'unknown'],
    ['nothing at all', null, 'unknown'],
  ])('%s', (_label, failure, reason) => {
    expect(sendFailureReason(failure)).toBe(reason);
  });

  it('offers no retry where a retry cannot succeed', () => {
    expect(describeSendFailure('not-member')).toMatchObject({ retryable: false });
    expect(describeSendFailure('unavailable')).toMatchObject({ retryable: false });
    expect(describeSendFailure('network')).toMatchObject({ retryable: true });
    expect(describeSendFailure(undefined)).toMatchObject({ label: 'Not sent', retryable: true });
  });

  it('says "Not sent", never that a failed message was sent', () => {
    ['network', 'auth', 'not-member', 'unavailable', 'refused', 'rate-limited', 'verification', 'unknown'].forEach((r) => {
      expect(describeSendFailure(r).label.startsWith('Not sent')).toBe(true);
    });
  });
});

describe('unsend on the client is only an offer', () => {
  const sentAt = Date.parse('2026-10-27T10:00:00.000Z');
  const msg = { id: 'm1', createdAt: new Date(sentAt).toISOString() };

  it('is offered up to and including 15 minutes, not after', () => {
    expect(canOfferUnsend(msg, sentAt)).toBe(true);
    expect(canOfferUnsend(msg, sentAt + UNSEND_WINDOW_MS)).toBe(true);
    expect(canOfferUnsend(msg, sentAt + UNSEND_WINDOW_MS + 1)).toBe(false);
  });

  it('explains the server refusals', () => {
    expect(unsendErrorMessage(httpError(400, 'UNSEND_WINDOW_EXPIRED'))).toMatch(/15 minutes/);
    expect(unsendErrorMessage(httpError(403, 'NOT_A_MEMBER'))).toMatch(/no longer in this group/);
    expect(unsendErrorMessage(new Error('Failed to fetch'))).toMatch(/connection/);
  });
});
