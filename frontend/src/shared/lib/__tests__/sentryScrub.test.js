import { describe, expect, it } from 'vitest';
import { FILTERED, featureFromPath, scrubBreadcrumb, scrubEvent, scrubUrl } from '../sentryScrub';

describe('sentryScrub', () => {
  it('keeps the path and parameter names but no query values', () => {
    expect(scrubUrl('/api/search?q=secret+crush&page=2')).toBe(
      `/api/search?q=${encodeURIComponent(FILTERED)}&page=${encodeURIComponent(FILTERED)}`,
    );
    expect(scrubUrl('https://x.test/a')).toBe('https://x.test/a');
  });

  it('drops console breadcrumbs (logs can carry user content)', () => {
    expect(scrubBreadcrumb({ category: 'console', message: 'hello' })).toBeNull();
  });

  it('scrubs navigation and fetch breadcrumbs', () => {
    const nav = scrubBreadcrumb({ category: 'navigation', data: { from: '/a?x=1', to: '/b?token=t' } });
    expect(JSON.stringify(nav)).not.toMatch(/x=1|token=t/);
    const fetchCrumb = scrubBreadcrumb({ category: 'fetch', data: { url: 'https://api/x?q=hi', status_code: 500 } });
    expect(fetchCrumb.data.url).not.toContain('hi');
    expect(fetchCrumb.data.status_code).toBe(500);
  });

  it('redacts credential and content keys and keeps only the user id', () => {
    const out = scrubEvent({
      extra: { accessToken: 't', text: 'my private message', count: 2 },
      user: { id: 7, email: 'a@b.c', ip_address: '1.1.1.1' },
      request: { headers: { Authorization: 'x', 'User-Agent': 'ua' }, data: 'body' },
    });
    expect(out.extra).toEqual({ accessToken: FILTERED, text: FILTERED, count: 2 });
    expect(out.user).toEqual({ id: '7' });
    expect(out.request.headers).toEqual({ 'User-Agent': 'ua' });
    expect(out.request.data).toBeUndefined();
  });

  it('names the feature from the route', () => {
    expect(featureFromPath('/messages/abc')).toBe('messages');
    expect(featureFromPath('/')).toBe('home');
  });
});
