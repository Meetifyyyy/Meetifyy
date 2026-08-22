import { create } from 'zustand';
import { io } from 'socket.io-client';
import { getBackendUrl, isApiFailoverActive, API_PROXY_PREFIX } from '@shared/api/apiClient';

export const useGlobalSocketStore = create((set, get) => ({
  socket: null,
  isConnected: false,
  reconnectCount: 0,
  _lastToken: null,
  _lastOrigin: null,
  _lastDeviceId: null,

  connect: (token, deviceId) => {
    const { socket, _lastToken, _lastOrigin } = get();
    const targetOrigin = getBackendUrl();

    // Singleton Guard: skip if a socket is already live for this token AND this
    // origin. The origin is part of the guard because API failover can move the
    // backend mid-session, and the existing socket is then pointed at a host
    // this network cannot reach.
    if (socket && token === _lastToken && targetOrigin === _lastOrigin && !socket.disconnected) {
      return;
    }

    if (socket) {
      try {
        socket.removeAllListeners();
        socket.disconnect();
      } catch {}
    }

    const socketUrl = getBackendUrl();
    // When the API has failed over to the same-origin proxy, realtime has to go
    // with it — the direct host is unreachable on this network. The proxy is an
    // HTTP rewrite, so the WebSocket upgrade will not complete through it and
    // the connection stays on long-polling. Degraded, but live.
    const viaProxy = isApiFailoverActive();
    const newSocket = io(socketUrl, {
      path: viaProxy ? `${API_PROXY_PREFIX}/socket.io` : '/socket.io',
      auth: { token, deviceId },
      // Start on long-polling and let engine.io upgrade to WebSocket once it has
      // proved the upgrade actually completes.
      //
      // WebSocket-first saves a round-trip on a clean network, but on the
      // filtered networks this app has to work on — college and public Wi-Fi
      // behind an intercepting proxy — the upgrade does not fail fast. The
      // proxy accepts the TCP connection and then resets or silently drops it,
      // so every connect burned the full handshake timeout before falling back,
      // and reconnects repeated that. Polling connects immediately on those
      // networks, and `upgrade: true` still gets a real WebSocket everywhere
      // that allows one, a few hundred milliseconds later.
      transports: ['polling', 'websocket'],
      upgrade: true,
      // Don't sit on a hung upgrade behind a middlebox that never answers.
      timeout: 8000,
      withCredentials: true,
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 15,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });

    newSocket.on('connect', () => {
      set((state) => ({
        isConnected: true,
        reconnectCount: state.reconnectCount + 1,
      }));
    });

    newSocket.on('disconnect', () => {
      set({ isConnected: false });
    });

    set({ socket: newSocket, _lastToken: token, _lastOrigin: socketUrl, _lastDeviceId: deviceId });
  },

  disconnect: () => {
    const { socket } = get();
    if (socket) {
      try {
        socket.removeAllListeners();
        socket.disconnect();
        socket.close();
      } catch {}
      set({ socket: null, isConnected: false, _lastToken: null, _lastOrigin: null, _lastDeviceId: null, reconnectCount: 0 });
    }
  },
}));

// API failover moves the backend to the same-origin proxy mid-session. The
// socket that is open at that moment is pointed at a host this network cannot
// reach, and its own reconnect loop would retry that same host forever — so
// rebuild it against the new origin.
if (typeof window !== 'undefined') {
  window.addEventListener('api:origin-changed', () => {
    const { socket, _lastToken, _lastDeviceId, connect } = useGlobalSocketStore.getState();
    if (!_lastToken) return;
    if (socket) {
      try {
        socket.removeAllListeners();
        socket.disconnect();
      } catch {}
      useGlobalSocketStore.setState({ socket: null, isConnected: false });
    }
    connect(_lastToken, _lastDeviceId);
  });
}
