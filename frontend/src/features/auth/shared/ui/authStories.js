/**
 * The story-column copy for each auth route, in one place.
 *
 * AuthShell reads this by path so the very first frame of a page already
 * shows its own words. The pages are lazy routes: before, the shell painted
 * its generic default ("Your campus, finally connected.") and the page's copy
 * replaced it once the page's chunk had loaded, a visible swap on every
 * reload. The pages pass the same entries, so the two can never disagree.
 */
export const AUTH_STORIES = Object.freeze({
  '/login': {
    headline: 'Good to see\n*you again.*',
    subtext: 'Your circles, your chats, your campus - right where you left them.',
  },
  '/forgot-password': {
    headline: 'Locked out?\n*We’ll get you back in.*',
    subtext: "Enter the email tied to your account and we'll send a secure reset link.",
  },
  '/reset-password': {
    headline: 'Almost there.\n*Set a fresh password.*',
    subtext: "Choose something strong you'll remember. Your campus circle is waiting.",
  },
});
