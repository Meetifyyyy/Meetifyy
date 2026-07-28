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

    // Skip reconnect if already connected with the same token
    if (socket?.connected && token === _lastToken) {
      return;
    }

    if (socket) {
      socket.disconnect();
    }

    const socketUrl = getBackendUrl();
    const newSocket = io(socketUrl, {
      auth: { token, deviceId },
      // WebSocket-first: skip the polling→upgrade round-trips (saves ~300ms).
      // Falls back to long-polling automatically if WebSocket is blocked.
      transports: ['websocket', 'polling'],
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
