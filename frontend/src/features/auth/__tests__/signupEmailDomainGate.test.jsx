/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';

/**
 * The email gate on the Academic Details step.
 *
 * These encode the four states the step must keep apart. It previously kept
 * apart only two, and the collapse had a specific, reachable consequence:
 * `student@gla.ac.` passed the old format regex (its trailing group matches
 * `ac.`, because a dot is neither whitespace nor an `@`), reached the
 * availability endpoint, was refused there as malformed with a 400, and the
 * client — whose catch block mapped every throw to "network error" — told the
 * user "Couldn't verify, you can still continue" and let them through.
 *
 *   valid + allowed domain  -> may continue
 *   valid + wrong domain    -> blocked, told which
 *   malformed / incomplete  -> blocked, told to fix the address
 *   check could not run     -> blocked, told to retry
 *
 * Only the first may advance the step.
 */

const postMock = vi.fn();
const nextStepMock = vi.fn();
const updateDataMock = vi.fn();

vi.mock('@shared/api/apiClient', () => ({
  apiClient: { post: (...a) => postMock(...a), get: async () => ({}) },
  getMediaUrl: (v) => v,
  deriveThumbnailKey: () => null,
  normalizeDicebearUrl: (v) => v,
}));

vi.mock('../context/SignupContext', () => ({
  useSignup: () => ({
    signupData: {},
    updateData: updateDataMock,
    nextStep: nextStepMock,
  }),
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

vi.mock('@shared/academics/useAcademicCatalog', () => ({
  useAcademicCatalog: () => ({ courses: [], loading: false, error: null }),
}));

const Step2Academic = (
  await import('../signup/components/Step2Academic')
).default;

/** Types an address and lets the 300ms debounce plus its request settle. */
async function typeEmail(value) {
  const input = document.getElementById('signup-email');
  await act(async () => {
    fireEvent.change(input, { target: { value } });
  });
  await act(async () => {
    vi.advanceTimersByTime(400);
    await Promise.resolve();
    await Promise.resolve();
  });
}

const continueButton = () => screen.getByRole('button', { name: /continue/i });

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  postMock.mockReset();
  nextStepMock.mockReset();
  updateDataMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('Academic step email gate', () => {
  it('allows an address on an approved domain', async () => {
    postMock.mockResolvedValue({ available: true });
    render(<Step2Academic />);
    await typeEmail('student@gla.ac.in');

    expect(postMock).toHaveBeenCalledWith(
      '/api/auth/check-email',
      { email: 'student@gla.ac.in' },
      expect.anything(),
    );
    expect(continueButton().disabled).toBe(false);
  });

  it('blocks an address on an unapproved domain and names the problem', async () => {
    postMock.mockResolvedValue({
      available: false,
      code: 'domain_not_allowed',
      reason: 'Please use your official GLA email.',
    });
    render(<Step2Academic />);
    await typeEmail('student@gmail.com');

    expect(screen.getByText(/official GLA email/i)).toBeTruthy();
    expect(continueButton().disabled).toBe(true);
  });

  // The regression. Each of these must be reported as a malformed address and
  // must never reach the server, because there is nothing to verify yet.
  it.each([
    'student@gla.ac.',
    'student@gla.',
    'student@',
    'student@gla',
    'student@gla..ac.in',
    'student@-gla.ac.in',
  ])('treats %s as an invalid address, not a failed check', async (email) => {
    postMock.mockResolvedValue({ available: true });
    render(<Step2Academic />);
    await typeEmail(email);

    expect(screen.getByText('Please enter a valid email address.')).toBeTruthy();
    expect(screen.queryByText(/still continue/i)).toBeNull();
    expect(postMock).not.toHaveBeenCalled();
    expect(continueButton().disabled).toBe(true);
  });

  it('blocks, and does not reassure, when the check cannot complete', async () => {
    postMock.mockRejectedValue(Object.assign(new Error('offline'), { name: 'TypeError' }));
    render(<Step2Academic />);
    await typeEmail('student@gla.ac.in');

    expect(screen.getByText(/couldn't verify your email right now/i)).toBeTruthy();
    expect(screen.queryByText(/still continue/i)).toBeNull();
    expect(continueButton().disabled).toBe(true);
  });

  it('blocks when the server refuses the input outright (4xx)', async () => {
    postMock.mockRejectedValue(Object.assign(new Error('Bad Request'), { status: 400 }));
    render(<Step2Academic />);
    await typeEmail('student@gla.ac.in');

    expect(screen.getByText('Please enter a valid email address.')).toBeTruthy();
    expect(continueButton().disabled).toBe(true);
  });

  it('never advances the step while the email is unverified', async () => {
    postMock.mockResolvedValue({
      available: false,
      code: 'domain_not_allowed',
      reason: 'Please select your college first.',
    });
    render(<Step2Academic />);
    await typeEmail('student@gmail.com');

    await act(async () => {
      fireEvent.submit(document.querySelector('form'));
      await Promise.resolve();
    });

    expect(nextStepMock).not.toHaveBeenCalled();
    expect(updateDataMock).not.toHaveBeenCalled();
  });

  it('carries no em dash in any message it renders', async () => {
    postMock.mockRejectedValue(new Error('offline'));
    render(<Step2Academic />);
    await typeEmail('student@gla.ac.in');
    expect(document.body.textContent).not.toContain('—');
  });
});
