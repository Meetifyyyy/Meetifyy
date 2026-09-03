import {
  classifyResendFailure,
  ResendRejection,
} from './resend-failure';

/**
 * Whether a failed Resend send may be retried through Brevo.
 *
 * The expensive mistake in both directions: retrying something Resend actually
 * accepted sends the email twice, and retrying a malformed message spends the
 * relay's quota to produce the same rejection.
 */

const transportError = (message: string, name = 'Error', code?: string) =>
  Object.assign(new Error(message), { name, ...(code ? { code } : {}) });

describe('classifying a Resend failure', () => {
  describe('safe to fail over — Resend said it did not send', () => {
    it('treats a rate limit as not sent', () => {
      expect(classifyResendFailure(new ResendRejection('slow down', 'rate_limit_exceeded', 429)))
        .toBe('not-sent');
    });

    it('treats daily and monthly quota exhaustion as not sent', () => {
      // This is the case the whole fallback exists for.
      expect(classifyResendFailure(new ResendRejection('quota', 'daily_quota_exceeded', 429)))
        .toBe('not-sent');
      expect(classifyResendFailure(new ResendRejection('quota', 'monthly_quota_exceeded', 429)))
        .toBe('not-sent');
    });

    it('treats a Resend 5xx as not sent, since it reported its own failure', () => {
      expect(classifyResendFailure(new ResendRejection('boom', 'internal_error', 503)))
        .toBe('not-sent');
    });

    it('treats a refused or unresolvable connection as not sent', () => {
      // The request never left, so nothing can have been accepted.
      expect(classifyResendFailure(transportError('connect ECONNREFUSED', 'Error', 'ECONNREFUSED')))
        .toBe('not-sent');
      expect(classifyResendFailure(transportError('getaddrinfo ENOTFOUND api.resend.com', 'Error', 'ENOTFOUND')))
        .toBe('not-sent');
    });
  });

  describe('must NOT fail over — the message may already be sent', () => {
    it('treats a timeout as ambiguous', () => {
      // Resend may have received and processed it with only the reply lost.
      expect(classifyResendFailure(transportError('request timed out', 'TimeoutError')))
        .toBe('ambiguous');
      expect(classifyResendFailure(transportError('aborted', 'AbortError')))
        .toBe('ambiguous');
    });

    it('treats a reset socket as ambiguous', () => {
      expect(classifyResendFailure(transportError('socket hang up', 'Error', 'ECONNRESET')))
        .toBe('ambiguous');
      expect(classifyResendFailure(transportError('read ETIMEDOUT', 'Error', 'ETIMEDOUT')))
        .toBe('ambiguous');
    });

    it('defaults an unrecognised error to ambiguous rather than guessing', () => {
      // Guessing "not sent" on something unfamiliar is what creates duplicates.
      expect(classifyResendFailure(transportError('something new and strange')))
        .toBe('ambiguous');
      expect(classifyResendFailure(null)).toBe('ambiguous');
      expect(classifyResendFailure(undefined)).toBe('ambiguous');
    });
  });

  describe('must NOT fail over — the relay would reject it too', () => {
    it('treats a validation error as permanent', () => {
      expect(classifyResendFailure(new ResendRejection('bad address', 'validation_error', 422)))
        .toBe('permanent');
    });

    it('treats other 4xx complaints as permanent', () => {
      // A 403 for an unverified domain, a 404, a 400: all about the request.
      expect(classifyResendFailure(new ResendRejection('forbidden', 'restricted_api_key', 403)))
        .toBe('permanent');
      expect(classifyResendFailure(new ResendRejection('bad request', 'invalid_parameter', 400)))
        .toBe('permanent');
    });

    it('does not misread 429 as a permanent 4xx', () => {
      expect(classifyResendFailure(new ResendRejection('too many', 'unknown_name', 429)))
        .toBe('not-sent');
    });
  });
});

describe('the failover decision built on it', () => {
  const decide = (failure: string, relayAvailable = true) =>
    relayAvailable && failure === 'not-sent';

  it('fails over when Resend is out of quota', () => {
    const f = classifyResendFailure(new ResendRejection('q', 'daily_quota_exceeded', 429));
    expect(decide(f)).toBe(true);
  });

  it('does NOT fail over on a timeout, so the email cannot go twice', () => {
    const f = classifyResendFailure(transportError('timed out', 'TimeoutError'));
    expect(decide(f)).toBe(false);
  });

  it('does NOT fail over on a bad recipient', () => {
    const f = classifyResendFailure(new ResendRejection('bad', 'validation_error', 422));
    expect(decide(f)).toBe(false);
  });

  it('does not fail over at all when no relay is configured', () => {
    const f = classifyResendFailure(new ResendRejection('q', 'daily_quota_exceeded', 429));
    expect(decide(f, false)).toBe(false);
  });
});
