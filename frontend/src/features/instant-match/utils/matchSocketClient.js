import { io } from 'socket.io-client';
import { getAcceptTimer } from './timerByActivity';
import { getBackendUrl } from '@shared/api/apiClient';

const BACKEND_URL = getBackendUrl();

class MatchSocketClient {
  constructor() {
    this.socket = null;
    this.callbacks = {};
    this.isMock = false;
  }

  on(event, callback) {
    this.callbacks[event] = callback;
    // If socket is already connected, attach the listener
    if (this.socket) {
      this.socket.on(event, callback);
    }
  }

  off(event) {
    if (this.socket) {
      this.socket.off(event, this.callbacks[event]);
    }
    delete this.callbacks[event];
  }

  connect(token, _currentUser) {
    if (this.socket?.connected) return;

    this.socket = io(BACKEND_URL, {
      auth: { token },
      transports: ['websocket'],
      autoConnect: true,
    });

    // Re-attach any callbacks that were registered before connect()
    for (const [event, cb] of Object.entries(this.callbacks)) {
      this.socket.on(event, cb);
    }

    this.socket.on('connect', () => {
      if (this.callbacks['connect']) this.callbacks['connect']({ status: 'ok' });
    });

    this.socket.on('disconnect', () => {
      if (this.callbacks['disconnect']) this.callbacks['disconnect']({});
    });
  }

  joinQueue(request) {
    if (!this.socket?.connected) return;
    this.socket.emit('queue:join', request);
  }

  cancelQueue() {
    if (!this.socket?.connected) return;
    this.socket.emit('queue:cancel', {});
  }

  respondToMatch(matchId, action) {
    if (!this.socket?.connected) return;
    this.socket.emit('match:respond', { matchId, action });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }
}

export default new MatchSocketClient();
