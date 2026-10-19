/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';

/**
 * When the Complete-your-profile prompt opens, and what "Later" does.
 * The server's `promptSnoozed` is the cross-device memory; localStorage (10 days) is
 * the fallback that keeps it closed for this session if the call fails.
 */

const { usersApi, signup } = vi.hoisted(() => ({
  usersApi: { snoozeProfilePrompt: vi.fn() },
  signup: { inProgress: false },
}));

vi.mock('@shared/api/apiClient', () => ({ usersApi }));
vi.mock('@features/auth/context/SignupContext', () => ({
  isSignupInProgress: () => signup.inProgress,
}));
vi.mock('@shared/components/AccountEmail/PersonalEmailForm', () => ({ default: () => <div /> }));
vi.mock('@shared/utils/toast', () => ({ showToast: vi.fn() }));
vi.mock('@shared/hooks/useScrollLock', () => ({ useScrollLock: () => {} }));

let initialUser;
vi.mock('@shared/context/AuthContext', () => ({
  useAuth: () => {
    // A stateful stand-in: updateCurrentUser re-renders like the real context.
    const [currentUser, setCurrentUser] = useState(initialUser);
    return {
      currentUser,
      updateCurrentUser: setCurrentUser,
      updateProfile: vi.fn().mockResolvedValue({}),
    };
  },
}));

import ProfileCompletionModal from '../ProfileCompletionModal';

const user = (completion) => ({ id: 'u1', profileCompletion: completion });
const mount = (completion, path = '/home') => {
  initialUser = user(completion);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ProfileCompletionModal />
    </MemoryRouter>,
  );
};
const dialog = () => screen.queryByRole('dialog');

beforeEach(() => {
  signup.inProgress = false;
  usersApi.snoozeProfilePrompt.mockReset().mockResolvedValue({ snoozed: true });
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(cleanup);

describe('ProfileCompletionModal visibility', () => {
  it('opens when gender is needed and it is not snoozed', () => {
    mount({ needsGender: true, needsPersonalEmail: false, promptSnoozed: false });
    expect(dialog()).not.toBeNull();
  });

  it('opens when only a personal email is needed', () => {
    mount({ needsGender: false, needsPersonalEmail: true });
    expect(dialog()).not.toBeNull();
  });

  it('stays closed while the server says it is snoozed', () => {
    mount({ needsGender: true, needsPersonalEmail: true, promptSnoozed: true });
    expect(dialog()).toBeNull();
  });

  it('stays closed once both flags are cleared', () => {
    mount({ needsGender: false, needsPersonalEmail: false, promptSnoozed: false });
    expect(dialog()).toBeNull();
  });

  it('stays closed during signup', () => {
    mount({ needsGender: true, needsPersonalEmail: false }, '/signup');
    expect(dialog()).toBeNull();
  });

  it('treats a backend without promptSnoozed as not snoozed', () => {
    mount({ needsGender: true, needsPersonalEmail: false });
    expect(dialog()).not.toBeNull();
  });
});

describe('"Later"', () => {
  it('calls the snooze endpoint, closes, and remembers it for the session', async () => {
    mount({ needsGender: true, needsPersonalEmail: false, promptSnoozed: false });
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));

    expect(usersApi.snoozeProfilePrompt).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(dialog()).toBeNull());
    expect(Number(localStorage.getItem('meetifyy:profile-completion-later:u1'))).toBeGreaterThan(0);
  });

  it('stays closed when the call fails (offline or older backend)', async () => {
    usersApi.snoozeProfilePrompt.mockRejectedValue(new Error('offline'));
    mount({ needsGender: true, needsPersonalEmail: false, promptSnoozed: false });
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));

    await waitFor(() => expect(usersApi.snoozeProfilePrompt).toHaveBeenCalled());
    expect(dialog()).toBeNull();
  });

  it('stays closed when the endpoint does not exist on the client at all', () => {
    usersApi.snoozeProfilePrompt.mockImplementation(() => {
      throw new TypeError('not a function');
    });
    mount({ needsGender: true, needsPersonalEmail: false });
    // A synchronous throw must not leave the dialog stuck open.
    expect(() => fireEvent.click(screen.getByRole('button', { name: 'Later' }))).not.toThrow();
    expect(dialog()).toBeNull();
  });
});
