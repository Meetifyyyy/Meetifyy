import { create } from 'zustand';
import { io } from 'socket.io-client';
import { getBackendUrl } from '@shared/api/apiClient';

const SOCKET_URL = getBackendUrl();

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

    const newSocket = io(SOCKET_URL, {
      auth: { token, deviceId },
      transports: ['websocket'],
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

