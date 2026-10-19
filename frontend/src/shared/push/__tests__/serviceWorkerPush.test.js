import { describe, it, expect, vi } from 'vitest';
import { handleNotificationClick, handlePush, pushPath } from '../serviceWorkerPush';

/**
 * The service worker's push and click handling. A push payload is
 * attacker-influenceable in principle, so a click may only ever open one of
 * this site's own routes, built from a validated Intent, never a URL taken
 * from the payload.
 */
const ORIGIN = 'https://meetifyy.app';

function fakeClients(windows = []) {
  return {
    matchAll: vi.fn(async () => windows),
    openWindow: vi.fn(async () => null),
  };
}

const win = (over = {}) => ({
  url: `${ORIGIN}/home`,
  visibilityState: 'hidden',
  focused: false,
  focus: vi.fn(async () => {}),
  postMessage: vi.fn(),
  ...over,
});

describe('push event', () => {
  it('shows the notification with the validated intent and bounded text', async () => {
    const registration = { showNotification: vi.fn(async () => {}) };
    await handlePush({
      payload: {
        title: 'Meetifyy',
        body: 'Aarav liked your post.',
        tag: 'n-abc',
        data: { v: '1', t: 'post', id: 'p1' },
      },
      clients: fakeClients([win()]),
      registration,
    });
    const [title, options] = registration.showNotification.mock.calls[0];
    expect(title).toBe('Meetifyy');
    expect(options.body).toBe('Aarav liked your post.');
    expect(options.data).toEqual({ t: 'post', id: 'p1' });
  });

  it('drops a raw URL in the payload and falls back to the notifications page', async () => {
    const registration = { showNotification: vi.fn(async () => {}) };
    await handlePush({
      payload: { title: 'x', data: { url: 'https://evil.example/phish' } },
      clients: fakeClients(),
      registration,
    });
    const options = registration.showNotification.mock.calls[0][1];
    expect(options.data).toEqual({ t: 'notifications' });
    expect(JSON.stringify(options)).not.toContain('evil.example');
  });

  it('shows nothing while the app is focused and visible (it already updated live)', async () => {
    const front = win({ visibilityState: 'visible', focused: true });
    const registration = { showNotification: vi.fn() };
    await handlePush({ payload: { data: { v: '1', t: 'notifications' } }, clients: fakeClients([front]), registration });
    expect(registration.showNotification).not.toHaveBeenCalled();
    expect(front.postMessage).toHaveBeenCalledWith({ type: 'meetifyy:push-foreground', path: '/notifications' });
  });

  it('survives a malformed payload', async () => {
    const registration = { showNotification: vi.fn(async () => {}) };
    await handlePush({ payload: null, clients: fakeClients(), registration });
    expect(registration.showNotification).toHaveBeenCalledWith('Meetifyy', expect.any(Object));
  });
});

describe('notification click', () => {
  it('routes an existing window in-app to the intent path', async () => {
    const own = win();
    const path = await handleNotificationClick({
      data: { t: 'chat', conversationId: 'pub-1' },
      clients: fakeClients([own]),
      origin: ORIGIN,
    });
    expect(path).toBe('/messages/pub-1');
    expect(own.focus).toHaveBeenCalled();
    expect(own.postMessage).toHaveBeenCalledWith({ type: 'meetifyy:push-open', path: '/messages/pub-1' });
  });

  it('opens a new window on this origin only, never a foreign one', async () => {
    const clients = fakeClients([win({ url: 'https://other.example/' })]);
    await handleNotificationClick({ data: { url: 'https://evil.example' }, clients, origin: ORIGIN });
    expect(clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/notifications`);
  });

  it('encodes identifiers so they cannot reach another route', () => {
    expect(pushPath({ t: 'post', id: '../admin?x=1' })).toBe('/post/..%2Fadmin%3Fx%3D1');
    expect(pushPath({ t: 'unknown' })).toBe('/notifications');
  });
});
