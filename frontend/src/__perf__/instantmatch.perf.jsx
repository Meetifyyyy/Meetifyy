import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { createRecorder, Profiled } from './profiler.jsx';

const CURRENT_USER = { id: 'me', username: 'me', displayName: 'Me', verificationStatus: 'VERIFIED' };

// ── A controllable stand-in for the shared socket ────────────────────────────
const listeners = new Map();
const emitted = [];
const socketApi = {
  on(event, cb) {
    let s = listeners.get(event);
    if (!s) { s = new Set(); listeners.set(event, s); }
    s.add(cb);
    return () => s.delete(cb);
  },
  fire(event, payload) {
    const s = listeners.get(event);
    if (s) for (const fn of [...s]) fn(payload);
  },
  reset() { listeners.clear(); emitted.length = 0; },
};

vi.mock('@features/instant-match/utils/matchSocketClient', () => ({
  default: {
    on: (e, cb) => socketApi.on(e, cb),
    off: () => {},
    get connected() { return true; },
    request: async (e, p) => { emitted.push([e, p]); return { ok: true, data: {} }; },
    joinQueue: async (r) => { emitted.push(['queue:join', r]); return { ok: true, data: {} }; },
    cancelQueue: async () => { emitted.push(['queue:cancel']); return { ok: true, data: {} }; },
    respondToMatch: async (id, a) => { emitted.push(['match:respond', id, a]); return { ok: true, data: {} }; },
    sync: async () => { emitted.push(['queue:sync']); return { ok: true, data: {} }; },
    chatState: async () => { emitted.push(['chat_state']); return { ok: true, data: {} }; },
    leaveChat: async () => ({ ok: true, data: {} }),
    acquire: () => () => {},
  },
}));

vi.mock('@shared/lib/supabase', () => ({
  supabase: { auth: {
    getSession: () => Promise.resolve({ data: { session: null } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: () => Promise.resolve({}),
  } },
  isSupabaseConfigured: false,
}));

const apiCalls = { getState: 0 };
vi.mock('@shared/api/apiClient', () => ({
  getMediaUrl: (u) => (typeof u === 'string' ? u : ''),
  instantMatchApi: {
    getState: async () => { apiCalls.getState++; return { data: { chat: null, state: { queued: null, pendingMatch: null, recentMatch: null } } }; },
  },
  messagesApi: { getConversations: async () => [] },
  postsApi: {},
  communitiesApi: { getAll: async () => [], getCampusCommunities: async () => [] },
}));

vi.mock('@shared/context/AuthContext', () => ({
  useAuth: () => ({ currentUser: CURRENT_USER, isLoggedIn: true, loading: false }),
  AuthProvider: ({ children }) => children,
}));
vi.mock('@shared/lib/idb', () => ({ idbGet: async () => null, idbSet: async () => {}, idbDelete: async () => {} }));
vi.mock('@stores/useGlobalSocketStore', () => ({
  useGlobalSocketStore: Object.assign(() => ({ socket: null, isConnected: true }), {
    getState: () => ({ socket: null, isConnected: true }),
    subscribe: () => () => {},
  }),
}));

// Count renders of the pieces that matter. Each is its own module, so the mock
// intercepts the reference the tree actually renders.
// `vi.mock` factories are hoisted, so each one is written out rather than
// produced by a shared helper the hoisted call could not yet see.
const counts = { radar: 0, metrics: 0, fab: 0, activity: 0, time: 0, location: 0 };
globalThis.__IM_COUNTS = counts;

vi.mock('@features/instant-match/components/queue/SearchRadar', async (io) => {
  const mod = await io(); const Real = mod.default;
  return { ...mod, default: (p) => { globalThis.__IM_COUNTS.radar++; return <Real {...p} />; } };
});
vi.mock('@features/instant-match/components/queue/QueueMetrics', async (io) => {
  const mod = await io(); const Real = mod.default;
  return { ...mod, default: (p) => { globalThis.__IM_COUNTS.metrics++; return <Real {...p} />; } };
});
vi.mock('@features/instant-match/components/steps/ActivityStep', async (io) => {
  const mod = await io(); const Real = mod.default;
  return { ...mod, default: (p) => { globalThis.__IM_COUNTS.activity++; return <Real {...p} />; } };
});
vi.mock('@features/instant-match/components/steps/TimeStep', async (io) => {
  const mod = await io(); const Real = mod.default;
  return { ...mod, default: (p) => { globalThis.__IM_COUNTS.time++; return <Real {...p} />; } };
});
vi.mock('@features/instant-match/components/steps/LocationStep', async (io) => {
  const mod = await io(); const Real = mod.default;
  return { ...mod, default: (p) => { globalThis.__IM_COUNTS.location++; return <Real {...p} />; } };
});

const { InstantMatchProvider, useInstantMatch } = await import('@features/instant-match/context/InstantMatchContext');
const { default: InstantMatchSheet } = await import('@features/instant-match/components/InstantMatchSheet');
const { default: InstantMatchFAB } = await import('@features/instant-match/components/InstantMatchFAB');

const ctl = {};
function Control() {
  const im = useInstantMatch();
  Object.assign(ctl, im);
  return null;
}

const settle = async (ms = 40) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const makeClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });

function Harness({ recorder }) {
  return (
    <QueryClientProvider client={makeClient()}>
      <MemoryRouter initialEntries={['/home']}>
        <InstantMatchProvider>
          <Control />
          <Profiled id="fab" recorder={recorder}>
            <InstantMatchFAB />
          </Profiled>
          <Profiled id="im" recorder={recorder}>
            <InstantMatchSheet />
          </Profiled>
        </InstantMatchProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('Instant Match', () => {
  const zero = () => Object.keys(counts).forEach((k) => { counts[k] = 0; });
  beforeEach(() => { zero(); socketApi.reset(); apiCalls.getState = 0; });

  it('profiles the flow: open, steps, search, radar, match found', async () => {
    const rec = createRecorder();
    render(<Harness recorder={rec} />);
    await settle(120);
    console.log('\n[MOUNT / idle FAB]', JSON.stringify({
      fabCommits: rec.get('fab').mounts + rec.get('fab').updates, commits: rec.get('im').mounts + rec.get('im').updates,
      actualMs: +rec.get('im').actual.toFixed(2), getStateCalls: apiCalls.getState,
    }));

    // The common case: a stats push while this user is just sitting on Home,
    // not searching. The server sends these whenever anyone anywhere queues.
    zero(); rec.reset();
    await act(async () => { socketApi.fire('queue:stats', { count: 5, sameActivity: 2, avgWaitSecs: 60 }); });
    await settle(30);
    console.log('[queue:stats WHILE IDLE ON HOME]', JSON.stringify({
      fabCommits: rec.get('fab').mounts + rec.get('fab').updates,
      actualMs: +rec.get('fab').actual.toFixed(2),
    }));

    // Open the sheet
    zero(); rec.reset();
    await act(async () => { ctl.openSheet(); });
    await settle(40);
    console.log('[OPEN SHEET]', JSON.stringify({
      activityStepRenders: counts.activity,
      commits: rec.get('im').mounts + rec.get('im').updates,
      actualMs: +rec.get('im').actual.toFixed(2),
    }));

    // Step 1 -> 2 (pick an activity)
    zero(); rec.reset();
    await act(async () => { ctl.updateFormData({ activity: 'coffee' }); ctl.setStep(2); }); // STEP_TIME
    await settle(40);
    console.log('[STEP 1->2]', JSON.stringify({
      activityStepRenders: counts.activity, timeStepRenders: counts.time,
      commits: rec.get('im').mounts + rec.get('im').updates,
      actualMs: +rec.get('im').actual.toFixed(2),
      onScreen: document.querySelector('.im-time-stack') ? 'TimeStep' : document.querySelector('.im-activity-grid') ? 'ActivityStep' : 'other',
    }));

    // Go to searching
    zero(); rec.reset();
    await act(async () => { ctl.updateFormData({ timePreference: 'now' }); });
    await act(async () => { await ctl.startSearch(); });
    await settle(60);
    console.log('[START SEARCH]', JSON.stringify({
      radarRenders: counts.radar, metricsRenders: counts.metrics,
      queueJoinEmits: emitted.filter((e) => e[0] === 'queue:join').length,
      actualMs: +rec.get('im').actual.toFixed(2),
      onScreen: document.querySelector('.im-radar') ? 'SearchingScreen' : 'other',
      status: ctl.status,
    }));

    // The radar sitting idle for 6 seconds: how often does React re-render it?
    // Settled in one-second slices: a single long `act()` window batches every
    // interval tick into one commit, which would flatter the result. Each slice
    // flushes on its own, the way a browser task would.
    zero(); rec.reset();
    for (let i = 0; i < 6; i++) await settle(1000);
    console.log('[RADAR IDLE 6s]', JSON.stringify({
      searchingScreenReRenders: counts.radar,
      metricsReRenders: counts.metrics,
      fabCommits: rec.get('fab').mounts + rec.get('fab').updates,
      commits: rec.get('im').mounts + rec.get('im').updates,
      actualMs: +rec.get('im').actual.toFixed(2),
    }));

    // A server queue-stats push while searching
    zero(); rec.reset();
    await act(async () => { socketApi.fire('queue:stats', { count: 7, sameActivity: 3, avgWaitSecs: 45 }); });
    await settle(30);
    console.log('[queue:stats PUSH]', JSON.stringify({
      radarReRenders: counts.radar, metricsReRenders: counts.metrics, fabCommits: rec.get('fab').mounts + rec.get('fab').updates,
      actualMs: +rec.get('im').actual.toFixed(2),
    }));

    expect(counts.radar).toBeGreaterThanOrEqual(0);
  }, 30000);
});
