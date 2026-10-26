/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';

const sessionId = { current: '' };

vi.mock('socket.io-client', () => ({ io: vi.fn() }));
vi.mock('@shared/api/apiClient', () => ({
  getBackendUrl: () => 'https://dev-api.meetifyy.app',
  getNativeSessionId: () => sessionId.current,
  getAccessToken: () => '',
  isApiFailoverActive: () => false,
  API_PROXY_PREFIX: '/proxy',
}));

const { useGlobalSocketStore } = await import('../useGlobalSocketStore');

/**
 * The installed app's socket after the server closed it. A token refresh
 * rotates the session id; a socket closed for the old id must come back under
 * the new one, and one closed for its own, still-current id must not.
 */
describe('reviving a socket the server closed', () => {
  const closedSocket = () => ({ connected: false, active: false, connect: vi.fn() });
  const comeBack = () => window.dispatchEvent(new Event('online'));

  it('dials again, once, when the session was rotated since', () => {
    const socket = closedSocket();
    useGlobalSocketStore.setState({ socket, _gaveUp: false, _lastSessionId: 'sess-old' });
    sessionId.current = 'sess-new';
    comeBack();
    expect(socket.connect).toHaveBeenCalledTimes(1);
    comeBack(); // the same new id: not dialled twice
    expect(socket.connect).toHaveBeenCalledTimes(1);
  });

  it('stays down for the same session: that is a real sign-out or refusal', () => {
    const socket = closedSocket();
    useGlobalSocketStore.setState({ socket, _gaveUp: false, _lastSessionId: 'sess-a' });
    sessionId.current = 'sess-a';
    comeBack();
    expect(socket.connect).not.toHaveBeenCalled();
  });

  it('leaves a socket still reconnecting on its own alone', () => {
    const socket = { connected: false, active: true, connect: vi.fn() };
    useGlobalSocketStore.setState({ socket, _gaveUp: false, _lastSessionId: 'sess-old' });
    sessionId.current = 'sess-new';
    comeBack();
    expect(socket.connect).not.toHaveBeenCalled();
  });
});
