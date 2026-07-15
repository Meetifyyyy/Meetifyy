import { initialUsers } from '@data/mockData';
import { getAcceptTimer } from './timerByActivity';

class MatchSocketClient {
  constructor() {
    this.socket = null;
    this.callbacks = {};
    this.isMock = true; // Easily toggleable to false when real backend is ready
    this.mockState = {
      queueInterval: null,
      matchTimeout: null,
      otherResponseTimeout: null,
      currentUser: null,
      currentRequest: null,
      statsInterval: null,
    };
  }

  on(event, callback) {
    this.callbacks[event] = callback;
  }

  off(event) {
    delete this.callbacks[event];
  }

  emit(event, data) {
    if (this.callbacks[event]) {
      this.callbacks[event](data);
    }
  }

  connect(token, currentUser) {
    this.mockState.currentUser = currentUser;

    if (!this.isMock) {
      // Real backend connection pattern (using standard secure ws)
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws/instant-match`;
      this.socket = new WebSocket(wsUrl);

      this.socket.onopen = () => {
        // Authenticate as the first message
        this.socket.send(JSON.stringify({ type: 'auth', token }));
      };

      this.socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          this.emit(payload.type, payload.data);
        } catch (err) {
          console.error('Error parsing socket message:', err);
        }
      };

      this.socket.onclose = () => {
        this.emit('disconnect', {});
      };
    } else {
      // Simulated server connection success
      setTimeout(() => {
        this.emit('connect', { status: 'ok' });
      }, 300);
    }
  }

  joinQueue(request) {
    if (!this.isMock) {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ type: 'queue:join', data: request }));
      }
      return;
    }

    this.mockState.currentRequest = request;

    // 1. Simulate stats updates immediately and then periodically
    this.sendMockStats();
    this.mockState.statsInterval = setInterval(() => {
      this.sendMockStats();
    }, 4000);

    // 2. Schedule a match found event
    const delay = 4000 + Math.random() * 3000; // 4 to 7 seconds
    this.mockState.matchTimeout = setTimeout(() => {
      this.triggerMockMatch();
    }, delay);
  }

  cancelQueue() {
    if (!this.isMock) {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ type: 'queue:cancel', data: {} }));
      }
      return;
    }

    this.clearMockTimers();
  }

  respondToMatch(matchId, action) {
    if (!this.isMock) {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ type: 'match:respond', data: { matchId, action } }));
      }
      return;
    }

    if (action === 'decline') {
      this.clearMockTimers();
      // Server resumes search after decline
      this.emit('match:declined', { reason: 'You declined the match' });
      setTimeout(() => {
        this.emit('search:resumed', {});
        // Restart search queue simulation
        this.joinQueue(this.mockState.currentRequest);
      }, 1000);
    } else if (action === 'accept') {
      // Simulate other user's response
      const decision = Math.random() > 0.35 ? 'accept' : 'decline'; // 65% accept rate
      const delay = 1000 + Math.random() * 2000; // 1-3 seconds response lag

      this.mockState.otherResponseTimeout = setTimeout(() => {
        if (decision === 'accept') {
          this.emit('match:accepted', { chatId: 'conv_instant_' + Math.floor(Math.random() * 10000) });
          this.clearMockTimers();
        } else {
          this.emit('match:declined', { reason: 'The other student was unavailable' });
          setTimeout(() => {
            this.emit('search:resumed', {});
            this.joinQueue(this.mockState.currentRequest);
          }, 1000);
        }
      }, delay);
    }
  }

  disconnect() {
    if (!this.isMock) {
      if (this.socket) {
        this.socket.close();
      }
    } else {
      this.clearMockTimers();
    }
  }

  // --- MOCK SIMULATOR HELPERS ---

  clearMockTimers() {
    if (this.mockState.statsInterval) clearInterval(this.mockState.statsInterval);
    if (this.mockState.matchTimeout) clearTimeout(this.mockState.matchTimeout);
    if (this.mockState.otherResponseTimeout) clearTimeout(this.mockState.otherResponseTimeout);
  }

  sendMockStats() {
    if (!this.mockState.currentRequest) return;
    const { activity } = this.mockState.currentRequest;
    
    // Simulate count of students searching for this activity
    const countMap = {
      study: [3, 4, 5, 6],
      coding: [1, 2, 3],
      sports: [2, 3, 4],
      coffee: [4, 5, 6],
      food: [5, 6, 7, 8],
      gaming: [2, 3],
      walk: [1, 2, 3],
      movie: [1, 2],
      event: [2, 3],
      chat: [3, 4, 5],
      library: [2, 3, 4],
      other: [1, 2]
    };

    const counts = countMap[activity] || [1, 2];
    const activeCount = counts[Math.floor(Math.random() * counts.length)];

    this.emit('queue:stats', {
      count: activeCount,
      avgWaitSecs: 120 // ~2 minutes
    });
  }

  triggerMockMatch() {
    if (!this.mockState.currentRequest) return;
    const { activity, timePreference } = this.mockState.currentRequest;

    // Pick a candidate from initialUsers (exclude current user if we know their username)
    const currentUsername = this.mockState.currentUser?.username || 'ethanwong';
    const usernames = Object.keys(initialUsers).filter(u => u !== currentUsername);
    const candidateUsername = usernames[Math.floor(Math.random() * usernames.length)];
    const candidate = initialUsers[candidateUsername];

    // Determine the match timer limit
    const limit = getAcceptTimer(activity, timePreference);

    const userInterests = this.mockState.currentUser?.interests || [];
    let candidateInterests = [...(candidate.interests || [])];
    if (userInterests.length > 0) {
      const count = Math.min(userInterests.length, 2);
      const shuffled = [...userInterests].sort(() => 0.5 - Math.random());
      const sharedToInject = shuffled.slice(0, count);
      candidateInterests = Array.from(new Set([...sharedToInject, ...candidateInterests]));
    }

    this.emit('match:found', {
      matchId: 'match_' + Math.floor(Math.random() * 100000),
      candidate: {
        id: candidate.id || 'mock_u',
        username: candidateUsername,
        displayName: candidate.displayName,
        avatar: candidate.avatar,
        avatarUrl: candidate.avatarUrl,
        course: candidate.course || 'B.Sc Computer Science',
        year: candidate.year || '3rd Year',
        interests: candidateInterests,
        bio: candidate.bio || ''
      },
      activity,
      area: this.mockState.currentRequest.location?.area || 'library',
      timer: limit
    });
  }
}

export default new MatchSocketClient();
