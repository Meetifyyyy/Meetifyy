/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Choosing a college on Campus opens that college's verification screen and
 * does nothing else: no code is sent, nothing is verified. The screen reads
 * back, logo and name, why, the email field (placeholder from the college's real
 * domain), its action. Back returns to the same list.
 */

const sendCode = vi.fn(() => Promise.resolve({ emailMasked: 'a***@gla.ac.in' }));
const verifyCode = vi.fn();
const systemBars = vi.fn();
let phone = true;

const COLLEGES = [
  { id: 'gla', name: 'GLA University, Mathura', domains: ['gla.ac.in'], logoUrl: null },
  ...Array.from({ length: 9 }, (_, i) => ({
    id: `c${i}`, name: `College ${String.fromCharCode(65 + i)}`, domains: [`c${i}.edu`], logoUrl: null,
  })),
];

vi.mock('@shared/api/apiClient', () => ({
  campusAffiliationApi: { listColleges: () => Promise.resolve({ colleges: COLLEGES }) },
  getMediaUrl: (u) => u,
}));
vi.mock('@shared/hooks/useMediaQuery', () => ({ useMediaQuery: () => phone }));
vi.mock('@shared/hooks/useOverlayBack', () => ({ useOverlayBack: () => {} }));
vi.mock('@shared/hooks/useSystemBars', () => ({
  useSystemBars: (config, enabled) => systemBars(config, enabled),
}));
vi.mock('@shared/hooks/useCampusAffiliationActions', () => ({
  useCampusAffiliationActions: () => ({ sendCode, verifyCode }),
}));
vi.mock('@shared/components/AccountEmail/ReauthModal', () => ({
  REAUTH_CANCELLED: 'cancelled',
  useReauth: () => ({ ensure: vi.fn(), invalidate: vi.fn(), current: vi.fn(), modal: null }),
}));
vi.mock('@shared/components/AccountEmail/withReauth', () => ({
  withReauth: (_r, fn) => fn(undefined),
}));
vi.mock('./../RequestCollege', () => ({
  RequestCollegeCard: () => null,
  RequestCollegeDialog: () => null,
}));

const CampusJoinFlow = (await import('../CampusJoinFlow')).default;

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CampusJoinFlow onVerified={vi.fn()} />
    </QueryClientProvider>,
  );
}

const pickGla = async () => {
  const card = await screen.findByRole('button', { name: /GLA University, Mathura/ });
  fireEvent.click(card);
};

describe('Campus join flow', () => {
  beforeEach(() => {
    sendCode.mockClear();
    verifyCode.mockClear();
    systemBars.mockClear();
    phone = true;
  });
  afterEach(cleanup);

  it('lists every college as a card with its name', async () => {
    mount();
    for (const c of COLLEGES) {
      expect(await screen.findByRole('button', { name: new RegExp(c.name) })).toBeTruthy();
    }
  });

  it('opens the verification screen without sending or verifying anything', async () => {
    mount();
    await pickGla();

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('GLA University, Mathura')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: /back to colleges/i })).toBeTruthy();
    expect(sendCode).not.toHaveBeenCalled();
    expect(verifyCode).not.toHaveBeenCalled();
  });

  it("builds the email placeholder from the college's own domain", async () => {
    mount();
    await pickGla();
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByPlaceholderText('you@gla.ac.in')).toBeTruthy();
  });

  it('puts back first, then the name, then the field', async () => {
    mount();
    await pickGla();
    const dialog = await screen.findByRole('dialog');
    const order = [
      within(dialog).getByRole('button', { name: /back to colleges/i }),
      within(dialog).getByText('GLA University, Mathura'),
      within(dialog).getByPlaceholderText('you@gla.ac.in'),
    ];
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('refuses a malformed address before asking the server', async () => {
    mount();
    await pickGla();
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByPlaceholderText('you@gla.ac.in'), { target: { value: 'nope' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /send code/i }));
    expect(await within(dialog).findByText(/full college email/i)).toBeTruthy();
    expect(sendCode).not.toHaveBeenCalled();
  });

  it('sends the code only when an address is submitted', async () => {
    mount();
    await pickGla();
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByPlaceholderText('you@gla.ac.in'), { target: { value: 'Asha@GLA.ac.in' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /send code/i }));
    await waitFor(() => expect(sendCode).toHaveBeenCalledTimes(1));
    expect(sendCode.mock.calls[0][0]).toMatchObject({ collegeId: 'gla', email: 'asha@gla.ac.in' });
  });

  it('goes back to the same list, keeping what was typed in the search', async () => {
    mount();
    const search = await screen.findByLabelText('Search colleges');
    fireEvent.change(search, { target: { value: 'GLA' } });
    await pickGla();
    fireEvent.click(await screen.findByRole('button', { name: /back to colleges/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 2000 });
    expect(screen.getByLabelText('Search colleges').value).toBe('GLA');
  });

  it('keeps the transparent status bar until the verify screen is fully in, and takes it back as it leaves', async () => {
    const enabled = () => systemBars.mock.calls.at(-1)[1];
    mount();
    await screen.findByRole('button', { name: /GLA University, Mathura/ });
    expect(enabled()).toBe(true);

    await pickGla();
    await screen.findByRole('dialog');
    // Tapped, sliding in: the page behind must not lose its bar yet (it shifted
    // down and painted a white strip when it did).
    expect(enabled()).toBe(true);
    // Arrived: the verify screen covers the page, so the bar can go.
    await waitFor(() => expect(enabled()).toBe(false), { timeout: 2000 });

    // Back: the bar returns as the slide-out starts, before the picker shows.
    fireEvent.click(screen.getByRole('button', { name: /back to colleges/i }));
    await waitFor(() => expect(enabled()).toBe(true), { timeout: 500 });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 2000 });
    expect(enabled()).toBe(true);
  });

  it('on a large screen shows the verification in place of the list, and back restores it', async () => {
    phone = false;
    mount();
    await pickGla();
    expect(await screen.findByPlaceholderText('you@gla.ac.in')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /back to colleges/i }));
    await waitFor(() => expect(screen.queryByPlaceholderText('you@gla.ac.in')).toBeNull());
    expect(screen.getByRole('button', { name: /GLA University, Mathura/ })).toBeTruthy();
  });
});
