/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const clearCachedData = vi.fn();
const estimateCacheUsage = vi.fn();
const showToast = vi.fn();

vi.mock('@shared/lib/clearCachedData', () => ({
  clearCachedData: (...a) => clearCachedData(...a),
  estimateCacheUsage: (...a) => estimateCacheUsage(...a),
}));
vi.mock('@shared/utils/toast', () => ({ showToast: (...a) => showToast(...a) }));
vi.mock('@shared/context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { id: 'u1', settings: {} },
    updateProfile: vi.fn(), updateSettings: vi.fn(), updateCurrentUser: vi.fn(),
    changePassword: vi.fn(), logout: vi.fn(),
  }),
}));
vi.mock('@shared/context/CookieConsentContext', () => ({ useCookieConsent: () => ({ openPreferences: vi.fn() }) }));
vi.mock('@shared/hooks/useProfileActionNeeded', () => ({ useProfileActionNeeded: () => ({ any: false }) }));
vi.mock('@shared/academics/useAcademicCatalog', () => ({ useAcademicCatalog: () => ({ courses: [], loading: false }) }));
vi.mock('@shared/api/apiClient', () => ({
  apiClient: { get: vi.fn(async () => ({})), post: vi.fn(async () => ({})), patch: vi.fn(async () => ({})) },
  getMediaUrl: (k) => k, normalizeDicebearUrl: (u) => u, deriveThumbnailKey: () => null,
}));
vi.mock('@shared/lib/supabase', () => ({ supabase: {}, isSupabaseConfigured: false }));

const { default: SettingsRoute, formatCacheUsage } = await import('../pages/SettingsRoute');

// The whole settings screen renders; under a parallel full run that is slow.
const SLOW = { timeout: 8000 };

let client;
function renderAt(path) {
  client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/settings" element={<SettingsRoute />} />
          <Route path="/settings/:panel" element={<SettingsRoute />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Settings → Clear cached data', () => {
  beforeEach(() => {
    clearCachedData.mockReset();
    estimateCacheUsage.mockReset();
    showToast.mockReset();
  });
  afterEach(cleanup);

  it('shows the approximate usage on the row', async () => {
    estimateCacheUsage.mockResolvedValue(12.4 * 1024 * 1024);
    const { findByText, getByText } = renderAt('/settings/privacy-security');
    expect(getByText('Clear cached data')).toBeTruthy();
    expect(await findByText('Uses about 12 MB on this device', {}, SLOW)).toBeTruthy();
  });

  it('confirms, clears with the query client, and says so', async () => {
    estimateCacheUsage.mockResolvedValue(null);
    clearCachedData.mockResolvedValue({ ok: true, failed: [] });
    const { getByText, findByText } = renderAt('/settings/privacy-security');
    fireEvent.click(getByText('Clear cached data'));
    expect(await findByText(/You stay signed in and nothing you haven't sent is lost\./, {}, SLOW)).toBeTruthy();
    expect(clearCachedData).not.toHaveBeenCalled();
    fireEvent.click(getByText('Clear'));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Cached data cleared', 'success'), SLOW);
    expect(clearCachedData).toHaveBeenCalledWith(client);
  });

  it('reports a failure', async () => {
    estimateCacheUsage.mockRejectedValue(new Error('no storage api'));
    clearCachedData.mockRejectedValue(new Error('nope'));
    const { getByText, findByText } = renderAt('/settings/privacy-security');
    fireEvent.click(getByText('Clear cached data'));
    fireEvent.click(await findByText('Clear', {}, SLOW));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("Couldn't clear cached data", 'error'), SLOW);
  });

  it('treats a partial clear as a failure', async () => {
    estimateCacheUsage.mockResolvedValue(null);
    clearCachedData.mockResolvedValue({ ok: false, failed: ['caches'] });
    const { getByText, findByText } = renderAt('/settings/privacy-security');
    fireEvent.click(getByText('Clear cached data'));
    fireEvent.click(await findByText('Clear', {}, SLOW));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("Couldn't clear cached data", 'error'), SLOW);
  });

  it('formats usage, and shows nothing when the platform cannot say', () => {
    expect(formatCacheUsage(500)).toBe('Uses less than 1 MB on this device');
    expect(formatCacheUsage(3.25 * 1024 * 1024)).toBe('Uses about 3.3 MB on this device');
    expect(formatCacheUsage({ bytes: 2 * 1024 ** 3 })).toBe('Uses about 2.0 GB on this device');
    expect(formatCacheUsage(null)).toBeNull();
    expect(formatCacheUsage(NaN)).toBeNull();
    expect(formatCacheUsage({})).toBeNull();
  });
});
