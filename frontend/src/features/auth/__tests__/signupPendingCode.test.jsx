/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';

/**
 * Returning to the password step after a code was already sent.
 *
 * POST /signup refuses a second signup for an address still waiting on its
 * code. Going back from the verify step ("Change email") and returning with
 * the same address used to dead-end here. Now:
 *   same address + same password  -> no second signup, straight to the code
 *   anything the server calls pending -> a warning with a way to the code
 */

const initiateSignup = vi.fn();
const nextStep = vi.fn();
const markCodeSent = vi.fn();
let signup;

vi.mock('@shared/context/AuthContext', () => ({ useAuth: () => ({ initiateSignup }) }));
vi.mock('../context/SignupContext', () => ({ useSignup: () => signup }));
vi.mock('react-router-dom', () => ({ Link: ({ children }) => <a>{children}</a> }));

const { default: Step4Password } = await import('../signup/components/Step4Password');

const PASSWORD = 'correct horse 9';

async function fillAndSubmit(password = PASSWORD) {
  fireEvent.change(document.getElementById('signup-password'), { target: { value: password } });
  fireEvent.change(document.getElementById('signup-confirm-password'), { target: { value: password } });
  fireEvent.click(document.getElementById('signup-legal-consent'));
  await act(async () => {
    fireEvent.submit(document.querySelector('form'));
  });
}

beforeEach(() => {
  initiateSignup.mockReset();
  nextStep.mockReset();
  markCodeSent.mockReset();
  signup = {
    signupData: { email: 'student@gla.ac.in' },
    updateData: vi.fn(),
    nextStep,
    pendingEmail: '',
    pendingPasswordRef: { current: null },
    markCodeSent,
  };
});

afterEach(cleanup);

describe('password step with a code already sent', () => {
  it('signs up and remembers the address on the first visit', async () => {
    initiateSignup.mockResolvedValue(true);
    render(<Step4Password />);
    await fillAndSubmit();
    expect(initiateSignup).toHaveBeenCalledTimes(1);
    expect(markCodeSent).toHaveBeenCalledWith('student@gla.ac.in', PASSWORD);
    expect(nextStep).toHaveBeenCalledTimes(1);
  });

  it('does not sign up twice for the same address and password', async () => {
    signup.pendingEmail = 'student@gla.ac.in';
    signup.pendingPasswordRef.current = PASSWORD;
    render(<Step4Password />);
    await fillAndSubmit();
    expect(initiateSignup).not.toHaveBeenCalled();
    expect(nextStep).toHaveBeenCalledTimes(1);
  });

  it('signs up again when the password changed', async () => {
    signup.pendingEmail = 'student@gla.ac.in';
    signup.pendingPasswordRef.current = 'the first one 1';
    initiateSignup.mockResolvedValue(true);
    render(<Step4Password />);
    await fillAndSubmit();
    expect(initiateSignup).toHaveBeenCalledTimes(1);
  });

  it('offers the code screen when the server says a signup is pending', async () => {
    initiateSignup.mockRejectedValue(
      new Error('A signup is already pending for this email. Check your inbox for the verification code, or wait a moment and try again.'),
    );
    render(<Step4Password />);
    await fillAndSubmit();
    expect(nextStep).not.toHaveBeenCalled();
    expect(await screen.findByText(/We already sent a code to this address/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Enter the code' }));
    expect(nextStep).toHaveBeenCalledTimes(1);
  });
});
