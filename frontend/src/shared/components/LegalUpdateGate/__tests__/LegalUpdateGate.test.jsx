/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';

/**
 * The mandatory policy-update gate. The server is the enforcement; these pin
 * what the dialog says, what "Got it" sends, and that it cannot be dismissed.
 */

const { legalApi, logout } = vi.hoisted(() => ({
  legalApi: {
    listDocuments: vi.fn(),
    getConsentState: vi.fn(),
    acknowledge: vi.fn(),
  },
  logout: vi.fn(),
}));

vi.mock('@shared/api/apiClient', () => ({ legalApi }));
vi.mock('@shared/context/AuthContext', () => ({
  useAuth: () => ({ isLoggedIn: true, logout }),
}));

const TERMS = {
  documentType: 'TERMS_OF_SERVICE',
  label: 'Terms of Service',
  path: '/terms-and-conditions',
  versionId: 'v-terms-3',
  versionNumber: 3,
  title: 'Terms and Conditions',
  content: '<h2>Terms</h2><p>Body of the terms.</p>',
  effectiveAt: '2026-11-01T00:00:00.000Z',
  changeSummary: 'Clarified how events are moderated.',
  requiresAcknowledgement: true,
};
const PRIVACY = {
  documentType: 'PRIVACY_POLICY',
  label: 'Privacy Policy',
  path: '/privacy-policy',
  versionId: 'v-privacy-2',
  versionNumber: 2,
  title: 'Privacy Policy',
  content: '<p>Body of the privacy policy.</p>',
  effectiveAt: null,
  changeSummary: null,
  requiresAcknowledgement: true,
};
const GUIDELINES = {
  documentType: 'COMMUNITY_GUIDELINES',
  label: 'Community Guidelines',
  path: '/community-guidelines',
  versionId: 'v-guide-1',
  versionNumber: 1,
  title: 'Community Guidelines',
  content: '<p>Be kind.</p>',
  requiresAcknowledgement: true,
};

function serverPending(pending) {
  legalApi.listDocuments.mockResolvedValue(pending);
  legalApi.getConsentState.mockResolvedValue({ satisfied: false, pending });
}

async function renderGate({ mobile = false } = {}) {
  vi.resetModules();
  vi.doMock('@config', async (orig) => ({ ...(await orig()), IS_MOBILE_BUILD: mobile }));
  const { default: LegalUpdateGate } = await import('../LegalUpdateGate');
  return render(
    <LegalUpdateGate>
      <div>App content</div>
    </LegalUpdateGate>,
  );
}

const dialog = () => screen.findByRole('dialog');

describe('LegalUpdateGate', { timeout: 20_000 }, () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });
  afterEach(() => cleanup());

  describe('title for each combination', () => {
    it.each([
      [[TERMS, PRIVACY], 'Updates to our Terms of Service and Privacy Policy'],
      // Server order does not matter: Terms always reads first.
      [[PRIVACY, TERMS], 'Updates to our Terms of Service and Privacy Policy'],
      [[TERMS], 'Updates to our Terms of Service'],
      [[PRIVACY], 'Updates to our Privacy Policy'],
      [[GUIDELINES], 'Updates to our Community Guidelines'],
    ])('%#', async (pending, title) => {
      serverPending(pending);
      await renderGate();
      const d = await dialog();
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(title);
      expect(d.getAttribute('aria-modal')).toBe('true');
      expect(d.getAttribute('aria-labelledby')).toBe('legal-update-title');
      expect(d.getAttribute('aria-describedby')).toBe('legal-update-desc');
    });
  });

  it('uses plural copy for two documents and singular for one', async () => {
    serverPending([TERMS, PRIVACY]);
    await renderGate();
    await dialog();
    const desc = document.getElementById('legal-update-desc').textContent;
    expect(desc).toBe(
      "We've updated our Terms of Service and Privacy Policy. Please take a moment to review them before you continue.",
    );
    expect(screen.queryByText(/By selecting Got it/)).toBeNull();

    cleanup();
    serverPending([PRIVACY]);
    await renderGate();
    await dialog();
    expect(document.getElementById('legal-update-desc').textContent).toBe(
      "We've updated our Privacy Policy. Please take a moment to review it before you continue.",
    );
  });

  it('puts initial focus on the title', async () => {
    serverPending([TERMS]);
    await renderGate();
    await dialog();
    await waitFor(() => expect(document.activeElement?.id).toBe('legal-update-title'));
  });

  it('has no checkbox and no close control', async () => {
    serverPending([TERMS, PRIVACY]);
    await renderGate();
    await dialog();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /close|dismiss|later/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Got it' }).disabled).toBe(false);
  });

  it('Got it acknowledges every pending version and clears the gate', async () => {
    serverPending([TERMS, PRIVACY]);
    legalApi.acknowledge.mockResolvedValue({ satisfied: true });
    await renderGate();
    await dialog();
    // The acceptance triggers a same-tab re-check; by then nothing is required.
    legalApi.listDocuments.mockResolvedValue([]);
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    await screen.findByText('App content');
    expect(legalApi.acknowledge).toHaveBeenCalledTimes(1);
    expect(legalApi.acknowledge).toHaveBeenCalledWith(['v-terms-3', 'v-privacy-2']);
    expect(localStorage.getItem('meetifyy_legal_pending')).toBeNull();
  });

  it('shows a loading state while saving and blocks a double submit', async () => {
    serverPending([TERMS]);
    let resolve;
    legalApi.acknowledge.mockReturnValue(new Promise((r) => { resolve = r; }));
    await renderGate();
    await dialog();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    const saving = await screen.findByRole('button', { name: /saving/i });
    expect(saving.disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Sign out' }).disabled).toBe(true);
    fireEvent.click(saving);
    expect(legalApi.acknowledge).toHaveBeenCalledTimes(1);
    legalApi.listDocuments.mockResolvedValue([]);
    await act(async () => resolve({ satisfied: true }));
  });

  it('re-checks after a partial acceptance and shows the new list', async () => {
    serverPending([TERMS]);
    legalApi.acknowledge.mockResolvedValue({ satisfied: false });
    await renderGate();
    await dialog();
    serverPending([PRIVACY]);
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Updates to our Privacy Policy'),
    );
    expect(legalApi.getConsentState).toHaveBeenCalledTimes(2);
  });

  it('shows one neutral sentence when acceptance fails', async () => {
    serverPending([TERMS]);
    legalApi.acknowledge.mockRejectedValue(new Error('TypeError: x is undefined at parse'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await renderGate();
    await dialog();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(
      'We could not record your acceptance. Check your connection and try again.',
    );
    spy.mockRestore();
  });

  it('Sign out calls logout', async () => {
    serverPending([TERMS]);
    await renderGate();
    await dialog();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(logout).toHaveBeenCalledTimes(1);
    expect(legalApi.acknowledge).not.toHaveBeenCalled();
  });

  it('opens the in-dialog reader from the document name, and goes back', async () => {
    serverPending([TERMS, PRIVACY]);
    await renderGate();
    await dialog();
    const desc = document.getElementById('legal-update-desc');
    fireEvent.click(
      Array.from(desc.querySelectorAll('button')).find((b) => b.textContent === 'Privacy Policy'),
    );
    expect(screen.getByRole('heading', { name: 'Privacy Policy' })).toBeTruthy();
    expect(screen.getByText('Body of the privacy policy.')).toBeTruthy();
    const d = screen.getByRole('dialog');
    expect(d.getAttribute('aria-labelledby')).toBe('legal-reader-title');
    // The reader is for reading: the actions return with the summary.
    expect(screen.queryByRole('button', { name: 'Got it' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
    expect(screen.getByRole('button', { name: /back/i }).textContent.trim()).toBe('');
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Got it' })).toBeTruthy();
  });

  it('the reader shows the version text from the API, not the bundled copy', async () => {
    serverPending([TERMS]);
    await renderGate();
    await dialog();
    const desc = document.getElementById('legal-update-desc');
    fireEvent.click(desc.querySelector('button'));
    expect(screen.getByText('Body of the terms.')).toBeTruthy();
    expect(screen.queryByText(/Welcome to Meetifyy/)).toBeNull();
  });

  it('falls back to the bundled website text only when the API body is empty', async () => {
    serverPending([{ ...TERMS, content: '' }]);
    await renderGate();
    await dialog();
    const desc = document.getElementById('legal-update-desc');
    fireEvent.click(desc.querySelector('button'));
    expect(await screen.findByText(/Welcome to Meetifyy/)).toBeTruthy();
  });

  it('lists no document cards: the subtitle links are the way in', async () => {
    serverPending([TERMS, PRIVACY]);
    await renderGate({ mobile: false });
    await dialog();
    expect(screen.queryByRole('list', { name: /updated documents/i })).toBeNull();
    expect(screen.queryByText('Clarified how events are moderated.')).toBeNull();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('in the app, never navigates away: the subtitle links open the reader', async () => {
    serverPending([TERMS, PRIVACY]);
    await renderGate({ mobile: true });
    await dialog();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    fireEvent.click(document.getElementById('legal-update-desc').querySelector('button'));
    expect(screen.getByText('Body of the terms.')).toBeTruthy();
  });

  it('ignores Escape', async () => {
    serverPending([TERMS]);
    await renderGate();
    const d = await dialog();
    fireEvent.keyDown(d, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('wraps Tab focus inside the dialog', async () => {
    serverPending([TERMS]);
    await renderGate();
    const d = await dialog();
    const signOut = screen.getByRole('button', { name: 'Sign out' });
    signOut.focus();
    fireEvent.keyDown(signOut, { key: 'Tab' });
    expect(d.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(signOut);
  });

  it('starts as a skeleton when the browser already knows something is pending', async () => {
    localStorage.setItem('meetifyy_legal_pending', '1');
    let resolveDocs;
    legalApi.listDocuments.mockReturnValue(new Promise((r) => { resolveDocs = r; }));
    legalApi.getConsentState.mockResolvedValue({ satisfied: false, pending: [TERMS] });
    await renderGate();
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByText('App content')).toBeNull();
    // The cookie banner hides on this attribute, so the skeleton must carry it.
    expect(document.querySelector('[data-legal-gate]')).toBeTruthy();
    await act(async () => resolveDocs([TERMS]));
    expect(await dialog()).toBeTruthy();
    expect(document.querySelector('[data-legal-gate]')).toBeTruthy();
  });


  it('fails open when the check errors', async () => {
    legalApi.listDocuments.mockRejectedValue(new Error('offline'));
    await renderGate();
    expect(await screen.findByText('App content')).toBeTruthy();
  });

  it('skips the per-user call when nothing requires acceptance', async () => {
    legalApi.listDocuments.mockResolvedValue([{ ...TERMS, requiresAcknowledgement: false }]);
    await renderGate();
    expect(await screen.findByText('App content')).toBeTruthy();
    expect(legalApi.getConsentState).not.toHaveBeenCalled();
  });
});
