import { describe, it, expect, vi, beforeEach } from 'vitest';

const sessionId = { current: '' };
const ioMock = vi.fn(() => ({ on: vi.fn(), removeAllListeners: vi.fn(), disconnect: vi.fn(), disconnected: false }));

vi.mock('socket.io-client', () => ({ io: (...args) => ioMock(...args) }));
vi.mock('@shared/api/apiClient', () => ({
  getBackendUrl: () => 'https://dev-api.meetifyy.app',
  getNativeSessionId: () => sessionId.current,
  isApiFailoverActive: () => false,
  API_PROXY_PREFIX: '/proxy',
}));

const { useGlobalSocketStore } = await import('../useGlobalSocketStore');

/** What the handshake would carry right now: socket.io calls `auth` on every (re)connect. */
function handshake() {
  const options = ioMock.mock.calls.at(-1)[1];
  let sent;
  options.auth((payload) => { sent = payload; });
  return sent;
}

describe('useGlobalSocketStore handshake', () => {
  beforeEach(() => {
    ioMock.mockClear();
    useGlobalSocketStore.setState({ socket: null, _lastToken: null, _lastOrigin: null });
  });

  it('names the installed app\'s session, which has no cookie to carry it', () => {
    sessionId.current = 'sess-123';
    useGlobalSocketStore.getState().connect('tok', 'dev-1');
    expect(handshake()).toEqual({ token: 'tok', deviceId: 'dev-1', sessionId: 'sess-123' });
  });

  it('reads the session id at each connection, so a rotated session is not sent stale', () => {
    sessionId.current = 'sess-1';
    useGlobalSocketStore.getState().connect('tok', 'dev-1');
    const options = ioMock.mock.calls.at(-1)[1];
    sessionId.current = 'sess-2';
    let sent;
    options.auth((payload) => { sent = payload; });
    expect(sent.sessionId).toBe('sess-2');
  });

  it('sends no session id on the web, where the cookie carries it', () => {
    sessionId.current = '';
    useGlobalSocketStore.getState().connect('tok', 'dev-1');
    expect(handshake().sessionId).toBeUndefined();
  });
});
