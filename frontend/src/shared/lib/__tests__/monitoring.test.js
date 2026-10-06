import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addBreadcrumb,
  captureError,
  clearMonitoringUser,
  createSentryAdapter,
  installMonitoring,
  isMonitoringActive,
  setMonitoringUser,
} from '../monitoring';

afterEach(() => installMonitoring(null));

function fakeSentry() {
  const scopes = [];
  return {
    scopes,
    withScope: vi.fn((fn) => {
      const scope = { tags: {}, extras: {}, setTag(k, v) { this.tags[k] = v; }, setTags(t) { Object.assign(this.tags, t); }, setExtras(e) { Object.assign(this.extras, e); } };
      scopes.push(scope);
      fn(scope);
    }),
    captureException: vi.fn(),
    addBreadcrumb: vi.fn(),
    setUser: vi.fn(),
  };
}

describe('monitoring facade', () => {
  it('is a silent no-op until a platform installs an adapter', () => {
    expect(isMonitoringActive()).toBe(false);
    expect(() => {
      captureError(new Error('x'));
      addBreadcrumb({ message: 'y' });
      setMonitoringUser('u1');
      clearMonitoringUser();
    }).not.toThrow();
  });

  it('never throws even if the SDK does', () => {
    installMonitoring({ captureError: () => { throw new Error('sdk broke'); } });
    expect(() => captureError(new Error('x'))).not.toThrow();
  });

  it('reports each error in its own scope with its feature', () => {
    const sentry = fakeSentry();
    installMonitoring(createSentryAdapter(sentry));
    const err = new Error('boom');
    captureError(err, { feature: 'messages', tags: { boundary: 'route' } });
    captureError(new Error('second'));
    expect(sentry.captureException).toHaveBeenCalledWith(err);
    expect(sentry.scopes[0].tags).toEqual({ feature: 'messages', boundary: 'route' });
    expect(sentry.scopes[1].tags).toEqual({});
  });

  it('sets the user by id only, and clears it', () => {
    const sentry = fakeSentry();
    installMonitoring(createSentryAdapter(sentry));
    setMonitoringUser(42);
    clearMonitoringUser();
    expect(sentry.setUser.mock.calls).toEqual([[{ id: '42' }], [null]]);
  });
});

describe('early-report buffer (website loads Sentry lazily)', () => {
  it('holds reports until the adapter arrives, then replays them in order', async () => {
    const { bufferUntilInstalled } = await import('../monitoring');
    bufferUntilInstalled();
    const early = new Error('during boot');
    addBreadcrumb({ message: 'first' });
    captureError(early);
    setMonitoringUser('u1');
    const sentry = fakeSentry();
    installMonitoring(createSentryAdapter(sentry));
    expect(sentry.addBreadcrumb).toHaveBeenCalledWith({ message: 'first' });
    expect(sentry.captureException).toHaveBeenCalledWith(early);
    expect(sentry.setUser).toHaveBeenCalledWith({ id: 'u1' });
  });

  it('holds nothing when Sentry is not coming, and is bounded', async () => {
    const { bufferUntilInstalled, stopBuffering } = await import('../monitoring');
    captureError(new Error('no buffer'));
    bufferUntilInstalled(2);
    for (let i = 0; i < 5; i += 1) captureError(new Error(`e${i}`));
    const sentry = fakeSentry();
    installMonitoring(createSentryAdapter(sentry));
    expect(sentry.captureException).toHaveBeenCalledTimes(2);
    installMonitoring(null);
    bufferUntilInstalled();
    captureError(new Error('dropped'));
    stopBuffering();
    const later = fakeSentry();
    installMonitoring(createSentryAdapter(later));
    expect(later.captureException).not.toHaveBeenCalled();
  });
});
