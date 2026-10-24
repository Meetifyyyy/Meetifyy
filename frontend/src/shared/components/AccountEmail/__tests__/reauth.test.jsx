/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';

const api = vi.hoisted(() => ({
  methods: vi.fn(),
  withPassword: vi.fn(),
  sendCode: vi.fn(),
  withCode: vi.fn(),
}));
vi.mock('@shared/api/apiClient', () => ({ reauthApi: api }));
// The overlay plumbing is exercised by ConfirmModal's own tests.
vi.mock('@shared/hooks/useOverlayBack', () => ({ useOverlayBack: () => {} }));
vi.mock('@shared/hooks/useScrollLock', () => ({ useScrollLock: () => {} }));
vi.mock('@shared/hooks/useSheetDrag', () => ({ useSheetDrag: () => null }));

const { default: ReauthModal, useReauth, REAUTH_CANCELLED, resetReauthMethodsCache } = await import(
  '../ReauthModal'
);
const { withReauth } = await import('../withReauth');
const { describeAccountEmailError, describeCampusOtpError, formatEligibleDate } = await import(
  '@shared/lib/campusAccess'
);

const GRANT = { reauthToken: 'tok-1', expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() };

beforeEach(() => {
  Object.values(api).forEach((m) => m.mockReset());
  resetReauthMethodsCache();
});
afterEach(cleanup);

describe('ReauthModal', () => {
  it('asks for the password, sends it to the server, and hands back the grant', async () => {
    api.methods.mockResolvedValue({ methods: ['password'] });
    api.withPassword.mockResolvedValue(GRANT);
    const onSuccess = vi.fn();
    render(<ReauthModal visible purpose="personal_email_change" onSuccess={onSuccess} onCancel={() => {}} />);

    const input = await screen.findByLabelText('Password');
    fireEvent.change(input, { target: { value: 'hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(GRANT));
    expect(api.withPassword).toHaveBeenCalledWith({ purpose: 'personal_email_change', password: 'hunter2' });
  });

  it('shows a wrong password and keeps the dialog open', async () => {
    api.methods.mockResolvedValue({ methods: ['password'] });
    api.withPassword.mockRejectedValue(Object.assign(new Error('x'), { status: 403, code: 'invalid_password' }));
    const onSuccess = vi.fn();
    render(<ReauthModal visible purpose="college_email_remove" onSuccess={onSuccess} onCancel={() => {}} />);
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('That password is incorrect.')).toBeTruthy();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('confirms an account without a password by an emailed code', async () => {
    api.methods.mockResolvedValue({ methods: ['email_code'] });
    api.sendCode.mockResolvedValue({ emailMasked: 'me***@gmail.com', resendAvailableAt: new Date().toISOString() });
    api.withCode.mockResolvedValue(GRANT);
    const onSuccess = vi.fn();
    render(<ReauthModal visible purpose="personal_email_change" onSuccess={onSuccess} onCancel={() => {}} />);

    expect(screen.queryByLabelText('Password')).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Send code' }));
    expect(await screen.findByText('me***@gmail.com')).toBeTruthy();
    // A pasted code fills every box and submits itself.
    const first = document.getElementById('reauth-otp-1');
    fireEvent.paste(first, { clipboardData: { getData: () => '123456' } });
    await waitFor(() =>
      expect(api.withCode).toHaveBeenCalledWith({ purpose: 'personal_email_change', code: '123456' }),
    );
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(GRANT));
  });
});

describe('useReauth + withReauth', () => {
  function Harness({ onReady }) {
    const reauth = useReauth('personal_email_change');
    onReady(reauth);
    return reauth.modal;
  }

  it('opens the dialog once, reuses the grant, and asks again after reauth_required', async () => {
    api.methods.mockResolvedValue({ methods: ['password'] });
    api.withPassword
      .mockResolvedValueOnce(GRANT)
      .mockResolvedValueOnce({ ...GRANT, reauthToken: 'tok-2' });
    let reauth;
    render(<Harness onReady={(r) => (reauth = r)} />);

    const request = vi
      .fn()
      .mockResolvedValueOnce('first')
      .mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'reauth_required' }))
      .mockResolvedValueOnce('third');

    let first;
    act(() => {
      first = withReauth(reauth, request);
    });
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await expect(first).resolves.toBe('first');
    expect(request).toHaveBeenLastCalledWith('tok-1');

    // The server refuses the held grant: one more prompt, then a retry.
    let second;
    act(() => {
      second = withReauth(reauth, request);
    });
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await expect(second).resolves.toBe('third');
    expect(request).toHaveBeenLastCalledWith('tok-2');
    expect(api.withPassword).toHaveBeenCalledTimes(2);
  });

  it('rejects with reauth_cancelled when the dialog is closed', async () => {
    api.methods.mockResolvedValue({ methods: ['password'] });
    let reauth;
    render(<Harness onReady={(r) => (reauth = r)} />);
    let pending;
    act(() => {
      pending = reauth.ensure();
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await expect(pending).rejects.toMatchObject({ code: REAUTH_CANCELLED });
  });

  it('in optional mode, tries without a grant and asks only when the server needs one', async () => {
    let reauth;
    render(<Harness onReady={(r) => (reauth = r)} />);
    const request = vi.fn().mockResolvedValue('ok');
    await expect(withReauth(reauth, request, { optional: true })).resolves.toBe('ok');
    expect(request).toHaveBeenCalledWith(null);
    expect(api.methods).not.toHaveBeenCalled();
  });
});

describe('method cache', () => {
  it('asks the server once, then opens straight to the cached method', async () => {
    api.methods.mockResolvedValue({ methods: ['password'] });
    const { rerender } = render(<ReauthModal visible purpose="college_email_remove" onCancel={() => {}} />);
    await screen.findByLabelText('Password');
    rerender(<ReauthModal visible={false} purpose="college_email_remove" onCancel={() => {}} />);
    rerender(<ReauthModal visible purpose="college_email_remove" onCancel={() => {}} />);
    expect(screen.getByLabelText('Password')).toBeTruthy();
    expect(api.methods).toHaveBeenCalledTimes(1);
  });

  it('switches to the password when the server says this account has one', async () => {
    api.methods.mockResolvedValue({ methods: ['email_code'] });
    api.sendCode.mockRejectedValue(Object.assign(new Error('x'), { status: 400, code: 'use_password' }));
    render(<ReauthModal visible purpose="personal_email_change" onCancel={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Send code' }));
    expect(await screen.findByLabelText('Password')).toBeTruthy();
  });
});

describe('cooldown messages', () => {
  it('show the server’s date in the viewer’s locale and time zone', () => {
    const iso = '2026-11-23T10:15:00.000Z';
    const err = { status: 403, code: 'email_change_cooldown', availableAt: iso };
    const expected = `For account security, you can change this email again on ${formatEligibleDate(iso)}.`;
    expect(describeAccountEmailError(err)).toBe(expected);
    expect(describeCampusOtpError(err)).toBe(expected);
    expect(formatEligibleDate(iso)).toBe(
      new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
    );
  });

  it('fall back to the server message without a date', () => {
    expect(
      describeAccountEmailError({ status: 403, code: 'email_change_cooldown', message: 'Server says no.' }),
    ).toBe('Server says no.');
  });
});
