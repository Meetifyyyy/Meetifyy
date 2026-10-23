/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const getMock = vi.fn();
const NOT_FOUND = vi.hoisted(() => Symbol('404'));
const auth = vi.hoisted(() => ({ value: {} }));

vi.mock('@shared/api/apiClient', () => ({
  campusAffiliationApi: {
    get: async (...a) => {
      const out = getMock(...a);
      // A plain marker rather than a rejected mock: the fake answers like the
      // transport does for an API without the route.
      if (out === NOT_FOUND) throw Object.assign(new Error('Not Found'), { status: 404 });
      return out;
    },
  },
}));
vi.mock('@shared/context/AuthContext', () => ({ useAuth: () => auth.value }));
const dropCampusCaches = vi.hoisted(() => vi.fn());
vi.mock('@shared/lib/campusCache', () => ({ dropCampusCaches }));

const { useCampusAffiliation, useCampusDeniedHandler } = await import('../useCampusAffiliation');

function wrapper({ children }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const ACTIVE = { collegeId: 'c1', collegeName: 'GLA', active: true };

beforeEach(() => getMock.mockReset());
afterEach(cleanup);

describe('useCampusAffiliation', () => {
  it('reads the affiliation off the user without a request when the API sends it', () => {
    auth.value = { isLoggedIn: true, currentUser: { id: 'u', verificationStatus: 'UNVERIFIED', campusAffiliation: ACTIVE } };
    const { result } = renderHook(() => useCampusAffiliation(), { wrapper });
    expect(result.current.status).toBe('active');
    expect(getMock).not.toHaveBeenCalled();
  });

  it('keeps Campus closed for a selfie-verified user without an affiliation', () => {
    auth.value = { isLoggedIn: true, currentUser: { id: 'u', verificationStatus: 'VERIFIED', collegeId: 'c1', campusAffiliation: null } };
    const { result } = renderHook(() => useCampusAffiliation(), { wrapper });
    expect(result.current.status).toBe('none');
  });

  it('restores a pending code from the server, not from the device', async () => {
    getMock.mockResolvedValue({ affiliation: null, pending: { collegeId: 'c1', collegeName: 'GLA', emailMasked: 'a***@gla.ac.in' } });
    auth.value = { isLoggedIn: true, currentUser: { id: 'u', campusAffiliation: null } };
    const { result } = renderHook(() => useCampusAffiliation({ withPending: true }), { wrapper });
    await waitFor(() => expect(result.current.pending?.collegeId).toBe('c1'));
    expect(result.current.status).toBe('none');
  });

  it('asks the endpoint when the user has no affiliation field (older session payload)', async () => {
    getMock.mockResolvedValue({ affiliation: ACTIVE, pending: null });
    auth.value = { isLoggedIn: true, currentUser: { id: 'u', verificationStatus: 'UNVERIFIED' } };
    const { result } = renderHook(() => useCampusAffiliation(), { wrapper });
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('active'));
  });

  it('falls back to the legacy rule when the API has no affiliation endpoint (404)', async () => {
    getMock.mockImplementation(() => NOT_FOUND);
    auth.value = { isLoggedIn: true, currentUser: { id: 'u', verificationStatus: 'VERIFIED', collegeId: 'c1' } };
    const { result } = renderHook(() => useCampusAffiliation(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('active'));
    expect(result.current.legacy).toBe(true);
  });
});

describe('useCampusAffiliation before the server confirms the session', () => {
  it('does not treat a cached active affiliation as authoritative', () => {
    auth.value = { isLoggedIn: true, profileFromCache: true, currentUser: { id: 'u', campusAffiliation: ACTIVE } };
    const { result } = renderHook(() => useCampusAffiliation(), { wrapper });
    expect(result.current.status).toBe('loading');
    expect(result.current.isActive).toBe(false);
  });

  describe('with no network', () => {
    afterEach(() => vi.restoreAllMocks());
    const offline = () => vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);

    it('keeps Campus open for a cached active affiliation, since the server cannot be asked', () => {
      offline();
      auth.value = { isLoggedIn: true, profileFromCache: true, currentUser: { id: 'u', campusAffiliation: ACTIVE } };
      const { result } = renderHook(() => useCampusAffiliation(), { wrapper });
      expect(result.current.status).toBe('active');
      expect(getMock).not.toHaveBeenCalled();
    });

    it('does not open Campus for a cached copy that is not active', () => {
      offline();
      auth.value = { isLoggedIn: true, profileFromCache: true, currentUser: { id: 'u', campusAffiliation: null } };
      const { result } = renderHook(() => useCampusAffiliation(), { wrapper });
      expect(result.current.status).toBe('loading');
    });
  });

  it('opens once the session is confirmed', () => {
    auth.value = { isLoggedIn: true, profileFromCache: false, currentUser: { id: 'u', campusAffiliation: ACTIVE } };
    const { result } = renderHook(() => useCampusAffiliation(), { wrapper });
    expect(result.current.status).toBe('active');
  });
});

describe('useCampusDeniedHandler', () => {
  it('drops every campus cache before re-reading the session on campus_affiliation_required', async () => {
    const order = [];
    dropCampusCaches.mockImplementation(() => order.push('drop'));
    const refreshCurrentUser = vi.fn(async () => { order.push('refresh'); });
    auth.value = { isLoggedIn: true, currentUser: { id: 'u', campusAffiliation: ACTIVE }, refreshCurrentUser };
    const { result } = renderHook(() => useCampusDeniedHandler(), { wrapper });

    result.current(Object.assign(new Error('nope'), { status: 403, code: 'other' }));
    expect(dropCampusCaches).not.toHaveBeenCalled();

    result.current(Object.assign(new Error('nope'), { status: 403, code: 'campus_affiliation_required' }));
    await waitFor(() => expect(refreshCurrentUser).toHaveBeenCalledTimes(1));
    expect(dropCampusCaches).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['drop', 'refresh']);
  });
});
