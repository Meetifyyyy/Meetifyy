import { useAuth } from '@shared/context/AuthContext';

/**
 * What the server still wants on the account: a gender, and a personal login
 * email when the account signs in with its college address. Independent of
 * "Later": snoozing the modal never hides the Settings dots. Both flags are
 * patched locally the moment the user saves, so the dots clear immediately.
 */
export function useProfileActionNeeded() {
  const { currentUser } = useAuth();
  const needsGender = Boolean(currentUser?.profileCompletion?.needsGender);
  const needsPersonalEmail = Boolean(currentUser?.profileCompletion?.needsPersonalEmail);
  return { needsGender, needsPersonalEmail, any: needsGender || needsPersonalEmail };
}
