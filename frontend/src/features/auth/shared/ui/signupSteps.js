/**
 * Names for the six signup steps, in order. One list so the desktop rail and
 * the compact mobile header can never disagree about what a step is called.
 * Module-level on purpose: AuthShell receives it through a layout effect whose
 * dependencies must be stable.
 *
 * Required steps first (1-5), the one optional step last, so nothing optional
 * is asked before the account exists.
 */
export const SIGNUP_STEPS = Object.freeze([
  { title: 'Say hello', caption: 'Name and college email' },
  { title: 'Your profile', caption: 'Username and birthday' },
  { title: 'College', caption: 'Course, branch and year' },
  { title: 'Password', caption: 'Create your account' },
  { title: 'Verify', caption: 'Code from your inbox' },
  { title: 'Photo', caption: 'Optional' },
]);
