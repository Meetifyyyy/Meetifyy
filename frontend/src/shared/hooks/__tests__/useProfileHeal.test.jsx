/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ getByUsername: vi.fn() }));
vi.mock('@shared/api/apiClient', () => ({ usersApi: api }));
vi.mock('@shared/lib/idb', () => ({ idbGet: vi.fn(async () => null), idbSet: vi.fn() }));
vi.mock('@shared/context/AuthContext', () => ({ useAuth: () => ({ isLoggedIn: true }) }));
vi.mock('../useIsVerified', () => ({ useIsVerified: () => true }));
vi.mock('@shared/components/ui/CoverImage', () => ({ warmCover: vi.fn() }));

import { useProfile } from '../useProfile';

let client;
const wrapper = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
const settle = (ms = 150) => act(() => new Promise((r) => setTimeout(r, ms)));

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.getByUsername.mockReset();
});
afterEach(() => client.clear());

describe('useProfile - completing a profile that was seeded without stats', () => {
  it('does not re-request forever when the server\'s own answer has no stats', async () => {
    // A trimmed profile: no `stats`, every time.
    api.getByUsername.mockResolvedValue({ id: 'u2', username: 'asha' });
    const { result } = renderHook(() => useProfile('asha'), { wrapper });

    await waitFor(() => expect(result.current.profile).toBeTruthy());
    await settle(400);

    // The first fetch, plus at most the single heal - not a request per frame.
    expect(api.getByUsername.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('still heals a stats-less SEED once, so a partial write is completed', async () => {
    api.getByUsername.mockResolvedValue({ id: 'u2', username: 'asha', stats: { followers: 3 } });
    client.setQueryData(['profile', 'asha'], { id: 'u2', username: 'asha' }); // seeded without stats
    const { result } = renderHook(() => useProfile('asha'), { wrapper });

    await waitFor(() => expect(result.current.profile?.stats).toEqual({ followers: 3 }));
    await settle(200);
    expect(api.getByUsername.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('re-arms after the profile was complete again, so a later partial write is healed too', async () => {
    api.getByUsername.mockResolvedValue({ id: 'u2', username: 'asha', stats: { followers: 3 } });
    const { result } = renderHook(() => useProfile('asha'), { wrapper });
    await waitFor(() => expect(result.current.profile?.stats).toBeTruthy());
    const before = api.getByUsername.mock.calls.length;

    // Something writes a partial profile over the complete one (e.g. a follow update).
    act(() => { client.setQueryData(['profile', 'asha'], { id: 'u2', username: 'asha' }); });

    await waitFor(() => expect(api.getByUsername.mock.calls.length).toBe(before + 1));
  });
});
