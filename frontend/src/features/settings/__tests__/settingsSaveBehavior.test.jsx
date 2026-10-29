/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Settings saves where it is and leaves only when asked.
 *
 *  - Save keeps the panel open and says so; it no longer closes the panel.
 *  - An on/off preference saves the moment it is switched, and switches back
 *    with an error when the server refuses. No Save button, no unsaved switch.
 *  - A form re-reads what is saved each time it is opened.
 *  - Leaving a form with unsaved edits asks first.
 */

const showToast = vi.fn();
const auth = {
  currentUser: {
    id: 'u1',
    username: 'asha',
    displayName: 'Asha',
    bio: 'Hello',
    birthday: '2004-03-07',
    interests: [],
    settings: { privateProfile: false, emailNotifs: true, showOnlineStatus: true, readReceipts: true },
  },
  updateProfile: vi.fn(),
  updateSettings: vi.fn(),
  updateCurrentUser: vi.fn(),
  changePassword: vi.fn(),
  logout: vi.fn(),
};

vi.mock('@shared/utils/toast', () => ({ showToast: (...a) => showToast(...a) }));
vi.mock('@shared/context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('@shared/lib/clearCachedData', () => ({ clearCachedData: async () => ({ ok: true }), estimateCacheUsage: async () => null }));
vi.mock('@shared/context/CookieConsentContext', () => ({ useCookieConsent: () => ({ openPreferences: vi.fn() }) }));
vi.mock('@shared/hooks/useProfileActionNeeded', () => ({ useProfileActionNeeded: () => ({ any: false }) }));
vi.mock('@shared/academics/useAcademicCatalog', () => ({ useAcademicCatalog: () => ({ courses: [], loading: false }) }));
vi.mock('@shared/api/apiClient', () => ({
  // The mount-time refresh finds nothing, so the account above is what is saved.
  apiClient: { get: vi.fn(async () => null), post: vi.fn(async () => null), patch: vi.fn(async () => ({})) },
  getMediaUrl: (k) => k, normalizeDicebearUrl: (u) => u, deriveThumbnailKey: () => null,
}));
vi.mock('@shared/lib/supabase', () => ({ supabase: {}, isSupabaseConfigured: false }));
vi.mock('../panels/PushNotificationsSettings', () => ({ default: () => null }));
vi.mock('../panels/SettingsHelpPanel', () => ({ default: () => <div>help panel</div> }));

const { default: SettingsRoute } = await import('../pages/SettingsRoute');

const SLOW = { timeout: 8000 };

let location = null;
function LocationProbe() {
  location = useLocation();
  return null;
}

function renderAt(path) {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <LocationProbe />
        <Routes>
          <Route path="/settings" element={<SettingsRoute />} />
          <Route path="/settings/:panel" element={<SettingsRoute />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const here = () => `${location.pathname}${location.search}`;
const toggleFor = (label) => screen.getByText(label).closest('div[class]').parentElement.querySelector('input[type="checkbox"]');

describe('Settings save and leave', () => {
  beforeEach(() => {
    showToast.mockReset();
    auth.updateProfile.mockReset();
    auth.updateSettings.mockReset();
    auth.updateCurrentUser.mockReset();
  });
  afterEach(() => { cleanup(); location = null; });

  it('stays on Edit Profile after saving, and only says saved once it is', async () => {
    let resolve;
    auth.updateProfile.mockImplementation(() => new Promise((r) => { resolve = r; }));
    renderAt('/settings/profile');

    fireEvent.change(screen.getByLabelText('Display Name'), { target: { value: 'Asha K' } });
    fireEvent.click(screen.getByText('Save Changes'));

    expect(auth.updateProfile).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'Asha K' }));
    expect(showToast).not.toHaveBeenCalledWith('Profile updated', 'success');
    resolve(true);

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Profile updated', 'success'), SLOW);
    expect(here()).toBe('/settings/profile');
    expect(screen.getByLabelText('Display Name').value).toBe('Asha K');
  });

  it('keeps the edits in the form when the save is refused', async () => {
    auth.updateProfile.mockRejectedValue(new Error('Server said no'));
    renderAt('/settings/profile');

    fireEvent.change(screen.getByLabelText('Bio'), { target: { value: 'New bio' } });
    fireEvent.click(screen.getByText('Save Changes'));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Server said no', 'error'), SLOW);
    expect(here()).toBe('/settings/profile');
    expect(screen.getByLabelText('Bio').value).toBe('New bio');
  });

  it('saves a visibility switch the moment it is flipped, with no Save button', async () => {
    auth.updateSettings.mockResolvedValue(true);
    renderAt('/settings/privacy');

    expect(screen.queryByText('Save Visibility Settings')).toBeNull();
    const priv = toggleFor('Private Profile');
    fireEvent.click(priv);

    expect(auth.updateSettings).toHaveBeenCalledWith({ privateProfile: true });
    await waitFor(() => expect(priv.checked).toBe(true), SLOW);
    expect(here()).toBe('/settings/privacy');
  });

  it('switches back and says so when the server refuses', async () => {
    // AuthContext reports a refused settings save as `false`, not a throw.
    auth.updateSettings.mockResolvedValue(false);
    renderAt('/settings/privacy');

    const receipts = toggleFor('Read Receipts');
    fireEvent.click(receipts);
    expect(auth.updateSettings).toHaveBeenCalledWith({ readReceipts: false });

    await waitFor(() => expect(showToast).toHaveBeenCalledWith("Couldn't save privacy settings", 'error'), SLOW);
    expect(receipts.checked).toBe(true);
  });

  it('saves Email notifications on toggle, like the push switches beside it', async () => {
    auth.updateSettings.mockResolvedValue(true);
    renderAt('/settings/notifications');

    expect(screen.queryByText('Save Notification Settings')).toBeNull();
    fireEvent.click(toggleFor('Email Notifications'));

    expect(auth.updateSettings).toHaveBeenCalledWith({ emailNotifs: false });
  });

  it('asks before Back throws away unsaved edits, and can keep editing', async () => {
    renderAt('/settings/profile');

    fireEvent.change(screen.getByLabelText('Display Name'), { target: { value: 'Unsaved' } });
    fireEvent.click(screen.getByLabelText('Go back'));

    expect(await screen.findByText('Discard changes?', {}, SLOW)).toBeTruthy();
    expect(here()).toBe('/settings/profile');

    fireEvent.click(screen.getByText('Keep editing'));
    await waitFor(() => expect(screen.queryByText('Discard changes?')).toBeNull(), SLOW);
    expect(here()).toBe('/settings/profile');
    expect(screen.getByLabelText('Display Name').value).toBe('Unsaved');
  });

  it('leaves on Discard, and the form shows what is saved when opened again', async () => {
    renderAt('/settings/profile');

    fireEvent.change(screen.getByLabelText('Display Name'), { target: { value: 'Unsaved' } });
    fireEvent.click(screen.getByLabelText('Go back'));
    fireEvent.click(await screen.findByText('Discard', {}, SLOW));

    await waitFor(() => expect(here()).toBe('/settings/account'), SLOW);
    fireEvent.click(await screen.findByText('Edit Profile', {}, SLOW));

    await waitFor(() => expect(here()).toBe('/settings/profile'), SLOW);
    expect(screen.getByLabelText('Display Name').value).toBe('Asha');
  }, 15000); // Waits out the dialog's close animation; slow under a full parallel run.

  it('leaves without asking when nothing was edited', async () => {
    renderAt('/settings/profile');

    fireEvent.click(screen.getByLabelText('Go back'));

    await waitFor(() => expect(here()).toBe('/settings/account'), SLOW);
    expect(screen.queryByText('Discard changes?')).toBeNull();
  });

  it('names a Help sub-view in the header', () => {
    renderAt('/settings/help?view=safety');
    expect(screen.getByText('Safety centre')).toBeTruthy();

    cleanup();
    renderAt('/settings/help?view=requests');
    expect(screen.getByText('Your requests')).toBeTruthy();
  });
});
