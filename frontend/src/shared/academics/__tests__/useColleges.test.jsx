/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
vi.mock('@shared/api/apiClient', () => ({ apiClient: { get: (...a) => get(...a) } }));

const { useColleges, COLLEGES_QUERY_KEY } = await import('../useColleges');

let client;
const wrapper = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

describe('useColleges', () => {
  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
    get.mockReset();
  });
  afterEach(cleanup);

  it('returns the same shape as before', async () => {
    get.mockResolvedValue({ colleges: [{ id: 'c1', name: 'One' }] });
    const { result } = renderHook(() => useColleges(), { wrapper });
    expect(result.current).toEqual({ colleges: [], loading: true, error: null });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toEqual({ colleges: [{ id: 'c1', name: 'One' }], loading: false, error: null });
    expect(get).toHaveBeenCalledWith('/api/academics/colleges');
  });

  it('fetches once for every mount within a day', async () => {
    get.mockResolvedValue({ colleges: [{ id: 'c1' }] });
    const a = renderHook(() => useColleges(), { wrapper });
    await waitFor(() => expect(a.result.current.loading).toBe(false));
    a.unmount();
    const b = renderHook(() => useColleges(), { wrapper });
    expect(b.result.current.colleges).toEqual([{ id: 'c1' }]);
    expect(b.result.current.loading).toBe(false);
    expect(get).toHaveBeenCalledTimes(1);
    const q = client.getQueryCache().find({ queryKey: COLLEGES_QUERY_KEY });
    expect(q.options.staleTime).toBe(24 * 60 * 60 * 1000);
  });

  it('treats a malformed body as an empty list', async () => {
    get.mockResolvedValue({ nope: true });
    const { result } = renderHook(() => useColleges(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.colleges).toEqual([]);
  });

  it('reports a failure as a message, and does not cache it', async () => {
    get.mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => useColleges(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false), { timeout: 3000 });
    expect(result.current.error).toBe('down');
    expect(result.current.colleges).toEqual([]);
    expect(client.getQueryData(COLLEGES_QUERY_KEY)).toBeUndefined();
  });
});
