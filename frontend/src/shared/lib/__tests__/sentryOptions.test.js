import { describe, expect, it } from 'vitest';
import { buildSentryOptions } from '../sentryOptions';

const sentry = (over = {}) => ({
  dsn: 'https://pub@o1.ingest.us.sentry.io/2',
  enabled: true,
  expectedEnvironment: '',
  tracesSampleRate: 0.05,
  propagateTraces: false,
  ...over,
});

const build = (over = {}) => buildSentryOptions({
  sentry: sentry(over.sentry),
  environment: 'production',
  isProduction: true,
  platform: 'web',
  release: 'meetifyy-web@abc',
  hostname: 'meetifyy.app',
  isNonProductionHost: false,
  apiOrigin: 'https://api.meetifyy.app',
  ...over,
  ...(over.sentry ? { sentry: sentry(over.sentry) } : {}),
});

describe('buildSentryOptions — whether Sentry starts', () => {
  it('starts with a DSN, reporting the build’s own environment and release', () => {
    const { options, disabledReason } = build();
    expect(disabledReason).toBeNull();
    expect(options).toMatchObject({
      environment: 'production',
      release: 'meetifyy-web@abc',
      sendDefaultPii: false,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,
    });
  });

  it('stays off without a DSN, or when disabled', () => {
    expect(build({ sentry: { dsn: '' } }).options).toBeNull();
    expect(build({ sentry: { enabled: false } }).options).toBeNull();
  });

  it('stays off when VITE_SENTRY_ENVIRONMENT disagrees with the build', () => {
    const { options, disabledReason } = build({ sentry: { expectedEnvironment: 'development' } });
    expect(options).toBeNull();
    expect(disabledReason).toMatch(/does not match/);
  });

  it('a production build on a development host stays off', () => {
    expect(build({ hostname: 'dev.meetifyy.app', isNonProductionHost: true }).options).toBeNull();
  });

  it('a development build on the production host stays off', () => {
    const r = build({ environment: 'development', isProduction: false, hostname: 'meetifyy.app' });
    expect(r.options).toBeNull();
    expect(r.disabledReason).toMatch(/production host/);
  });

  it('a development build on the development host starts, as development', () => {
    const r = build({ environment: 'development', isProduction: false, hostname: 'dev.meetifyy.app', isNonProductionHost: true });
    expect(r.options?.environment).toBe('development');
  });

  it('the app skips host checks (it is served from localhost)', () => {
    const r = build({ platform: 'android', hostname: '' });
    expect(r.options?.initialScope.tags.app).toBe('android');
  });

  it('only propagates trace headers when asked, and only to the API', () => {
    expect(build().options.tracePropagationTargets).toEqual([]);
    expect(build({ sentry: { propagateTraces: true } }).options.tracePropagationTargets).toEqual([
      'https://api.meetifyy.app',
    ]);
  });
});

describe('buildSentryOptions — what is sent', () => {
  it('tags the feature and scrubs the event', () => {
    const { options } = build();
    const event = options.beforeSend({
      request: { url: 'https://meetifyy.app/search?q=private', cookies: { a: 'b' } },
      user: { id: 'u1', email: 'x@y.z' },
    });
    expect(event.tags.feature).toBeTruthy();
    expect(event.request.url).not.toContain('private');
    expect(event.request.cookies).toBeUndefined();
    expect(event.user).toEqual({ id: 'u1' });
  });
});
