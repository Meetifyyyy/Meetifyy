import type { Event } from '@sentry/nestjs';
import { REDACTED, scrubEvent, scrubUrl, scrubValue } from './sentry-scrub';

describe('sentry-scrub', () => {
  it('drops cookies, bodies and credential headers from the request', () => {
    const event: Event = {
      request: {
        url: 'https://dev-api.meetifyy.app/api/auth/callback?code=abc&next=/home',
        method: 'POST',
        cookies: { mf_access: 'jwt' },
        data: { password: 'hunter2' },
        headers: {
          authorization: 'Bearer x',
          cookie: 'mf_access=jwt',
          'x-csrf-token': 't',
          'user-agent': 'UA',
          'content-type': 'application/json',
        },
        query_string: 'token=abc&page=2',
      },
    };
    const out = scrubEvent(event);
    expect(out.request?.cookies).toBeUndefined();
    expect(out.request?.data).toBeUndefined();
    expect(out.request?.headers).toEqual({
      'user-agent': 'UA',
      'content-type': 'application/json',
    });
    expect(out.request?.url).not.toContain('abc');
    expect(out.request?.url).toContain('next=');
    expect(out.request?.query_string).toContain('page=2');
    expect(out.request?.query_string).not.toContain('abc');
  });

  it('keeps only the internal user id', () => {
    const out = scrubEvent({
      user: { id: 'u1', email: 'a@b.c', ip_address: '1.2.3.4', username: 'x' },
    });
    expect(out.user).toEqual({ id: 'u1' });
  });

  it('redacts sensitive keys anywhere in extra, contexts, breadcrumbs and spans', () => {
    const out = scrubEvent({
      extra: { refreshToken: 'r', nested: { password: 'p', ok: 1 } },
      contexts: { session: { id: 's' }, os: { name: 'Linux' } },
      breadcrumbs: [{ data: { url: 'https://x.test/a?token=t', status: 500 } }],
      spans: [
        {
          span_id: '1',
          trace_id: '2',
          start_timestamp: 0,
          data: { 'http.request.header.cookie': 'c', 'http.method': 'GET' },
          description: 'GET https://x.test/a?sig=zzz',
        },
      ],
    });
    expect(out.extra).toEqual({
      refreshToken: REDACTED,
      nested: { password: REDACTED, ok: 1 },
    });
    expect(out.contexts).toEqual({ session: REDACTED, os: { name: 'Linux' } });
    expect(JSON.stringify(out.breadcrumbs)).not.toContain('token=t');
    expect(out.spans?.[0].data).toEqual({
      'http.request.header.cookie': REDACTED,
      'http.method': 'GET',
    });
    expect(out.spans?.[0].description).not.toContain('zzz');
  });

  it('handles relative and unparseable URLs and cycles', () => {
    expect(scrubUrl('/api/x?token=1&a=2')).toBe(
      `/api/x?token=${encodeURIComponent(REDACTED)}&a=2`,
    );
    expect(scrubUrl('/plain')).toBe('/plain');
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(() => scrubValue(cyclic)).not.toThrow();
  });
});
