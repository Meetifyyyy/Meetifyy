/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act, cleanup } from '@testing-library/react';

/**
 * A completed code is verified once.
 *
 * Verifying signs the user in, which re-renders the signup flow and gave the
 * step's submit handler a new identity. The auto-submit effect was keyed on
 * that identity, so the same code was verified a second time the moment the
 * first attempt succeeded. The provider refused the spent code (it logged the
 * pair: 200, then 403 otp_expired), and the step flickered between states
 * while the flow moved on.
 */

const verifySignupOtp = vi.hoisted(() => vi.fn());
const signup = vi.hoisted(() => ({ data: { email: 'a@college.edu', username: 'a' } }));

vi.mock('@shared/context/AuthContext', () => ({
  useAuth: () => ({ verifySignupOtp, resendSignupOtp: vi.fn() }),
}));
vi.mock('../context/SignupContext', () => ({
  // A fresh object on every render, as the real provider's is after sign-in.
  useSignup: () => ({ signupData: { ...signup.data }, nextStep: vi.fn() }),
}));

const { default: Step4OTP } = await import('../signup/components/Step4OTP');

const typeCode = (container, digits) => {
  const inputs = container.querySelectorAll('input');
  digits.split('').forEach((d, i) => fireEvent.change(inputs[i], { target: { value: d } }));
};

describe('Step 4 — verification code', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { cleanup(); });

  it('submits a completed code exactly once, even when it re-renders after success', async () => {
    verifySignupOtp.mockResolvedValue(true);
    const { container, rerender } = render(<Step4OTP />);

    await act(async () => { typeCode(container, '123456'); });
    // What signing in does to the flow above this step.
    await act(async () => { rerender(<Step4OTP />); });
    await act(async () => { rerender(<Step4OTP />); });

    expect(verifySignupOtp).toHaveBeenCalledTimes(1);
  });

  it('does not resubmit a code that failed, but does submit a corrected one', async () => {
    verifySignupOtp.mockRejectedValueOnce(new Error('Invalid code')).mockResolvedValue(true);
    const { container, rerender, findByText } = render(<Step4OTP />);

    await act(async () => { typeCode(container, '111111'); });
    await findByText(/Invalid code/);
    await act(async () => { rerender(<Step4OTP />); });
    expect(verifySignupOtp).toHaveBeenCalledTimes(1);

    const inputs = container.querySelectorAll('input');
    await act(async () => { fireEvent.change(inputs[5], { target: { value: '2' } }); });
    expect(verifySignupOtp).toHaveBeenCalledTimes(2);
    expect(verifySignupOtp).toHaveBeenLastCalledWith('a@college.edu', '111112', expect.anything());
  });
});
