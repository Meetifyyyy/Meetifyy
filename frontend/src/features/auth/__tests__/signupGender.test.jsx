/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';

/**
 * Signup step 2 asks for gender, and it is required there (the API keeps it
 * optional, because older app builds never send it).
 */

const nextStepMock = vi.fn();
const updateDataMock = vi.fn();
const signupData = vi.hoisted(() => ({ value: {} }));

vi.mock('@shared/api/apiClient', () => ({
  readCsrfCookie: () => '',
  mayHaveCookieSession: () => false,
  rememberCsrfToken: () => {},
  forgetCsrfToken: () => {},
  authApi: {
    currentSession: async () => ({ user: null }),
    adoptSession: async () => ({}),
    logoutSession: async () => ({}),
  },
  apiClient: { post: async () => ({ available: true }), get: async () => ({}) },
  getMediaUrl: (v) => v,
  deriveThumbnailKey: () => null,
  normalizeDicebearUrl: (v) => v,
}));

vi.mock('../context/SignupContext', () => ({
  useSignup: () => ({
    signupData: signupData.value,
    updateData: updateDataMock,
    nextStep: nextStepMock,
  }),
}));

const Step2Profile = (await import('../signup/components/Step2Profile')).default;

const submit = async () => {
  await act(async () => {
    fireEvent.submit(document.querySelector('form'));
    await Promise.resolve();
  });
};

beforeEach(() => {
  nextStepMock.mockReset();
  updateDataMock.mockReset();
});
afterEach(cleanup);

describe('Signup gender (step 2)', () => {
  it('offers the four options and blocks the step without one', async () => {
    signupData.value = { username: 'asha', birthday: '2003-04-05' };
    render(<Step2Profile />);
    expect(screen.getByText('Gender')).toBeTruthy();
    await submit();
    expect(screen.getByText('Please select your gender.')).toBeTruthy();
    expect(nextStepMock).not.toHaveBeenCalled();
  });

  it('saves the API value with the rest of the step', async () => {
    signupData.value = { username: 'asha', birthday: '2003-04-05', gender: 'PREFER_NOT_TO_SAY' };
    render(<Step2Profile />);
    // The username check is debounced; let it settle as available.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    await submit();
    expect(updateDataMock).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'asha', birthday: '2003-04-05', gender: 'PREFER_NOT_TO_SAY' }),
    );
    expect(nextStepMock).toHaveBeenCalledTimes(1);
  });
});
