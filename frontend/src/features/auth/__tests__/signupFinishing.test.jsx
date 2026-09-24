/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { StrictMode } from 'react';

/**
 * The finishing screen after the last signup step.
 *
 *  - It always shows its messages, even when the server answers at once.
 *  - It never leaves while `completeSignup` is still out: no timer-based
 *    redirect that would abandon the request.
 *  - It calls `completeSignup` exactly once, StrictMode included, because a
 *    second call sends a second welcome email.
 */

const completeSignup = vi.fn();
const clearSignupData = vi.fn();
const navigate = vi.fn();

vi.mock('@shared/context/AuthContext', () => ({ useAuth: () => ({ completeSignup }) }));
vi.mock('../context/SignupContext', () => ({ useSignup: () => ({ clearSignupData }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('@shared/components/avatar/Avatar', () => ({ default: () => null }));

const { default: SignupFinishing } = await import('../signup/components/SignupFinishing');

/**
 * Advances in 100ms slices, flushing promises between them, so a timer that
 * is only scheduled once a promise settles still fires inside the window.
 */
async function advance(ms) {
  for (let elapsed = 0; elapsed < ms; elapsed += 100) {
    await act(async () => {
      vi.advanceTimersByTime(Math.min(100, ms - elapsed));
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  completeSignup.mockReset();
  clearSignupData.mockReset();
  navigate.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('SignupFinishing', () => {
  it('shows every message even when the account finishes instantly', async () => {
    completeSignup.mockResolvedValue(true);
    render(<SignupFinishing avatar="" />);

    expect(screen.getByText(/Creating your profile/)).toBeTruthy();
    await advance(1100);
    expect(screen.getByText(/Wait a moment/)).toBeTruthy();
    await advance(1100);
    expect(screen.getByText(/Almost done/)).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();

    await advance(1200);
    expect(screen.getByText(/You're in/)).toBeTruthy();
    await advance(800);
    expect(clearSignupData).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/home', { replace: true });
  });

  it('keeps spinning until completeSignup settles', async () => {
    let resolve;
    completeSignup.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<SignupFinishing avatar="" />);

    await advance(20000);
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByText(/Almost done/)).toBeTruthy();
    expect(screen.getByText(/taking longer than usual/)).toBeTruthy();

    await act(async () => { resolve(true); });
    await advance(800);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('still moves on after a failure, as the old flow did', async () => {
    completeSignup.mockRejectedValue(new Error('boom'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<SignupFinishing avatar="" />);
    await advance(3400);
    await advance(800);
    expect(navigate).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });

  it('calls completeSignup once under StrictMode', async () => {
    completeSignup.mockResolvedValue(true);
    render(<StrictMode><SignupFinishing avatar="https://x/a.png" /></StrictMode>);
    await advance(4500);
    expect(completeSignup).toHaveBeenCalledTimes(1);
    expect(completeSignup).toHaveBeenCalledWith({ avatar: 'https://x/a.png' });
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});
