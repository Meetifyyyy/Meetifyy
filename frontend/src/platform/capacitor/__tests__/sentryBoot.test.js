/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'android' } }));

import { bootCapacitorSentry } from '../sentryBoot';
import { captureError, installMonitoring, isMonitoringActive, stopBuffering } from '@shared/lib/monitoring';

/**
 * The app's Sentry boot: decides on/off at once, holds everything reported
 * before the SDK chunk is started, and starts it exactly once, when asked.
 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function config({ dsn = 'https://key@o0.ingest.sentry.io/1', enabled = true } = {}) {
  return {
    env: 'development',
    isProduction: false,
    isDevBuild: false,
    api: { baseUrl: 'https://api.example.test' },
    integrations: { sentry: { dsn, enabled, expectedEnvironment: '', tracesSampleRate: 1, propagateTraces: false } },
  };
}

describe('bootCapacitorSentry', () => {
  beforeEach(() => {
    installMonitoring(null);
    stopBuffering();
  });
  afterEach(() => {
    installMonitoring(null);
    stopBuffering();
  });

  it('is off, with nothing to start, without a DSN', () => {
    const loadSdk = vi.fn();
    expect(bootCapacitorSentry({ isDevServer: false, config: config({ dsn: '' }), appVersion: '1.0', loadSdk })).toBeNull();
    expect(loadSdk).not.toHaveBeenCalled();
  });

  it('does not load the SDK until asked', async () => {
    const loadSdk = vi.fn(async () => { throw new Error('not in this test'); });
    const load = bootCapacitorSentry({ isDevServer: false, config: config(), appVersion: '1.0', loadSdk });
    expect(typeof load).toBe('function');
    expect(loadSdk).not.toHaveBeenCalled();
    // Settle it, so its early handlers do not stay on the window for later tests.
    load();
    await flush();
  });

  it('holds reports made before the SDK and delivers them when it starts', async () => {
    const captured = [];
    const startCapacitorSentry = vi.fn((options, platform) => {
      expect(platform).toBe('android');
      expect(options.release).toBe('meetifyy-android@1.0+abc');
      installMonitoring({ captureError: (e) => captured.push(e), addBreadcrumb() {}, setUser() {} });
    });
    const load = bootCapacitorSentry({ isDevServer: false,
      config: config(), appVersion: '1.0+abc', loadSdk: async () => ({ startCapacitorSentry }),
    });
    const early = new Error('boom during boot');
    captureError(early);
    expect(captured).toHaveLength(0);
    load();
    await flush();
    expect(startCapacitorSentry).toHaveBeenCalledTimes(1);
    expect(captured).toEqual([early]);
  });

  it('catches uncaught errors and rejections before the SDK, and stops once it is in', async () => {
    const captured = [];
    const removed = [];
    const original = window.removeEventListener.bind(window);
    const remove = vi.spyOn(window, 'removeEventListener').mockImplementation((type, ...rest) => {
      removed.push(type);
      return original(type, ...rest);
    });
    const load = bootCapacitorSentry({ isDevServer: false,
      config: config(), appVersion: '1.0',
      loadSdk: async () => ({
        startCapacitorSentry: () => installMonitoring({ captureError: (e) => captured.push(e), addBreadcrumb() {}, setUser() {} }),
      }),
    });
    const thrown = new Error('uncaught');
    window.dispatchEvent(new ErrorEvent('error', { error: thrown, message: 'uncaught' }));
    const rejection = new Event('unhandledrejection');
    rejection.reason = new Error('rejected');
    window.dispatchEvent(rejection);
    load();
    await flush();
    expect(captured.map((e) => e.message)).toEqual(['uncaught', 'rejected']);
    // The SDK has its own handlers from here: the early ones are gone.
    expect(removed).toEqual(expect.arrayContaining(['error', 'unhandledrejection']));
    remove.mockRestore();
  });

  it('starts the SDK once however often it is asked', async () => {
    const startCapacitorSentry = vi.fn(() => installMonitoring({ captureError() {}, addBreadcrumb() {}, setUser() {} }));
    const loadSdk = vi.fn(async () => ({ startCapacitorSentry }));
    const load = bootCapacitorSentry({ isDevServer: false, config: config(), appVersion: '1.0', loadSdk });
    load();
    load();
    await flush();
    load();
    await flush();
    expect(loadSdk).toHaveBeenCalledTimes(1);
    expect(startCapacitorSentry).toHaveBeenCalledTimes(1);
  });

  it('stops holding reports if the SDK chunk cannot load', async () => {
    const load = bootCapacitorSentry({ isDevServer: false,
      config: config(), appVersion: '1.0', loadSdk: async () => { throw new Error('chunk failed'); },
    });
    load();
    await flush();
    expect(isMonitoringActive()).toBe(false);
    // Nothing is held any more: a later install receives nothing from before.
    captureError(new Error('after failure'));
    const captured = [];
    installMonitoring({ captureError: (e) => captured.push(e), addBreadcrumb() {}, setUser() {} });
    expect(captured).toEqual([]);
  });
});
