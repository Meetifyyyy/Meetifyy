/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

async function load({ mobile, siteUrl }) {
  vi.resetModules();
  vi.doMock('@config', () => ({ IS_MOBILE_BUILD: mobile, config: { app: { siteUrl } } }));
  return (await import('../publicOrigin')).publicOrigin;
}

describe('publicOrigin', () => {
  beforeEach(() => vi.resetModules());

  it('is the page origin in a browser, so dev links open dev and localhost links open localhost', async () => {
    const publicOrigin = await load({ mobile: false, siteUrl: 'https://meetifyy.app' });
    expect(publicOrigin()).toBe(window.location.origin);
  });

  it('is the configured site URL in the installed app, whose own origin opens nowhere', async () => {
    const publicOrigin = await load({ mobile: true, siteUrl: 'https://dev.meetifyy.app' });
    expect(publicOrigin()).toBe('https://dev.meetifyy.app');
  });

  it('drops a trailing slash so a path can be appended', async () => {
    const publicOrigin = await load({ mobile: true, siteUrl: 'https://dev.meetifyy.app/' });
    expect(`${publicOrigin()}/post/1`).toBe('https://dev.meetifyy.app/post/1');
  });

  it('falls back to the page origin when the app has no site URL configured', async () => {
    const publicOrigin = await load({ mobile: true, siteUrl: '' });
    expect(publicOrigin()).toBe(window.location.origin);
  });
});
