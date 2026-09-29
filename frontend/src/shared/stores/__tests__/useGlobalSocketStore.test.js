import { describe, it, expect, vi, beforeEach } from 'vitest';

const sessionId = { current: '' };
const accessToken = { current: '' };
const ioMock = vi.fn(() => ({ on: vi.fn(), removeAllListeners: vi.fn(), disconnect: vi.fn(), disconnected: false }));

vi.mock('socket.io-client', () => ({ io: (...args) => ioMock(...args) }));
vi.mock('@shared/api/apiClient', () => ({
  getBackendUrl: () => 'https://dev-api.meetifyy.app',
  getNativeSessionId: () => sessionId.current,
  getAccessToken: () => accessToken.current,
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

  it('names the installed app\'s session, which has no cookie to carry it', async () => {
    sessionId.current = 'sess-123';
    await useGlobalSocketStore.getState().connect('tok', 'dev-1');
    expect(handshake()).toEqual({ token: 'tok', deviceId: 'dev-1', sessionId: 'sess-123' });
  });

  it('takes the token from the API client when the caller has none (the installed app keeps it in secure storage)', async () => {
    sessionId.current = 'sess-123';
    accessToken.current = 'stored-token';
    await useGlobalSocketStore.getState().connect(undefined, 'dev-1');
    expect(handshake()).toEqual({ token: 'stored-token', deviceId: 'dev-1', sessionId: 'sess-123' });
  });

  it('reads the token at each connection, so a refreshed token is not sent stale', async () => {
    accessToken.current = 'old';
    await useGlobalSocketStore.getState().connect(undefined, 'dev-1');
    const options = ioMock.mock.calls.at(-1)[1];
    accessToken.current = 'new';
    let sent;
    options.auth((payload) => { sent = payload; });
    expect(sent.token).toBe('new');
  });

  it('reads the session id at each connection, so a rotated session is not sent stale', async () => {
    sessionId.current = 'sess-1';
    await useGlobalSocketStore.getState().connect('tok', 'dev-1');
    const options = ioMock.mock.calls.at(-1)[1];
    sessionId.current = 'sess-2';
    let sent;
    options.auth((payload) => { sent = payload; });
    expect(sent.sessionId).toBe('sess-2');
  });

  it('sends no session id on the web, where the cookie carries it', async () => {
    sessionId.current = '';
    accessToken.current = '';
    await useGlobalSocketStore.getState().connect('tok', 'dev-1');
    expect(handshake().sessionId).toBeUndefined();
    expect(handshake().token).toBe('tok');
  });

  it('does not open a socket for a connect that was cancelled while the library loaded', async () => {
    const pending = useGlobalSocketStore.getState().connect('tok', 'dev-1');
    useGlobalSocketStore.getState().disconnect();
    await pending;
    expect(ioMock).not.toHaveBeenCalled();
  });
});
