import { create } from 'zustand';
import { io } from 'socket.io-client';
import { getBackendUrl } from '@shared/api/apiClient';

export const useGlobalSocketStore = create((set, get) => ({
  socket: null,
  isConnected: false,
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
      transports: ['polling', 'websocket'],
      withCredentials: true,
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    newSocket.on('connect', () => {
      set({ isConnected: true });
    });

    newSocket.on('disconnect', () => {
      set({ isConnected: false });
    });

    set({ socket: newSocket, _lastToken: token });
  },

  disconnect: () => {
    const { socket } = get();
    if (socket) {
      socket.disconnect();
      set({ socket: null, isConnected: false, _lastToken: null });
    }
  },
}));

