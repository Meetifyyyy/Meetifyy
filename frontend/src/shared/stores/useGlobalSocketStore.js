import { create } from 'zustand';
import { io } from 'socket.io-client';
import { getBackendUrl } from '@shared/api/apiClient';

export const useGlobalSocketStore = create((set, get) => ({
  socket: null,
  isConnected: false,
  reconnectCount: 0,
  _lastToken: null,

  connect: (token, deviceId) => {
    const { socket, _lastToken } = get();

    // Singleton Guard: Skip if socket already exists and is active/connecting with the same token
    if (socket && token === _lastToken && !socket.disconnected) {
      return;
    }

    if (socket) {
      try {
        socket.removeAllListeners();
        socket.disconnect();
      } catch {}
    }

    const socketUrl = getBackendUrl();
    const newSocket = io(socketUrl, {
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

    set({ socket: newSocket, _lastToken: token });
  },

  disconnect: () => {
    const { socket } = get();
    if (socket) {
      try {
        socket.removeAllListeners();
        socket.disconnect();
        socket.close();
      } catch {}
      set({ socket: null, isConnected: false, _lastToken: null, reconnectCount: 0 });
    }
  },
}));
