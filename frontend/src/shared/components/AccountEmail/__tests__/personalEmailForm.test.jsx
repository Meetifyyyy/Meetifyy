/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const reauthApi = vi.hoisted(() => ({ methods: vi.fn(), withPassword: vi.fn(), sendCode: vi.fn(), withCode: vi.fn() }));
const accountEmailApi = vi.hoisted(() => ({ sendOtp: vi.fn(), verify: vi.fn() }));
vi.mock('@shared/api/apiClient', () => ({ reauthApi, accountEmailApi }));
vi.mock('@shared/context/AuthContext', () => ({
  useAuth: () => ({ currentUser: { id: 'u', email: 'old@example.com' }, updateCurrentUser: vi.fn() }),
}));
vi.mock('@shared/hooks/useOverlayBack', () => ({ useOverlayBack: () => {} }));
vi.mock('@shared/hooks/useScrollLock', () => ({ useScrollLock: () => {} }));
vi.mock('@shared/hooks/useSheetDrag', () => ({ useSheetDrag: () => null }));

const { default: PersonalEmailForm } = await import('../PersonalEmailForm');
const { resetReauthMethodsCache } = await import('../ReauthModal');

const GRANT = { reauthToken: 'tok', expiresAt: new Date(Date.now() + 600000).toISOString() };

function renderForm(props) {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <PersonalEmailForm {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  [...Object.values(reauthApi), ...Object.values(accountEmailApi)].forEach((m) => m.mockReset());
  resetReauthMethodsCache();
  reauthApi.methods.mockResolvedValue({ methods: ['password'] });
});
afterEach(cleanup);

describe('PersonalEmailForm', () => {
  it('shown unasked (profile prompt): no dialog until "Send code", then the grant goes with the request', async () => {
    reauthApi.withPassword.mockResolvedValue(GRANT);
    accountEmailApi.sendOtp.mockResolvedValue({ emailMasked: 'ne***@example.com', resendAvailableAt: null });
    renderForm({});
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.change(screen.getByLabelText('Personal email'), { target: { value: 'new@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() =>
      expect(accountEmailApi.sendOtp).toHaveBeenCalledWith({ email: 'new@example.com', reauthToken: 'tok' }),
    );
    expect(screen.queryByLabelText('Current password')).toBeNull();
  });

  it('with reauthFirst (Settings): asks at once, and declining cancels the form', async () => {
    const onCancel = vi.fn();
    renderForm({ reauthFirst: true, onCancel });
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(onCancel).toHaveBeenCalled());
    expect(accountEmailApi.sendOtp).not.toHaveBeenCalled();
  });
});
