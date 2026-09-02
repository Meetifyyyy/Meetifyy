/**
 * The one default avatar, and the one way to recognise it.
 *
 * There were three fallbacks before this: the inline SVG drawn by `Avatar`,
 * `/default_avatar.svg`, and `/default_avatar.webp` hardcoded into roughly
 * twenty `onError` handlers — plus a fourth on the server, which is what
 * actually shipped grey to production. Four copies meant recolouring the
 * default was never one edit, and two separate attempts to fix the grey avatar
 * each missed a copy. Everything now points here.
 */
export const DEFAULT_AVATAR_SRC = '/default_avatar.svg';

/**
 * True when a stored avatar value is the platform's own placeholder rather
 * than a picture the user chose.
 *
 * Accounts that never picked an avatar do not have an empty `avatar` field —
 * the backend writes a real media reference to the bundled default
 * (`/api/media/defaults/profile-avatar-v2.webp`). That is deliberate: a default
 * that *is* a stored image flows through crops, shares and OG cards like any
 * other picture. But it also means "has no avatar" is indistinguishable from
 * "has an avatar" to any check that only tests for null or empty, so the client
 * would fetch the placeholder over the network instead of drawing the one it
 * already has.
 *
 * Recognising the reference lets those accounts render the canonical default
 * immediately and locally, which is the difference between the avatar being
 * correct and it being correct only while the bucket, the `Media` row and
 * `R2_PUBLIC_URL` all cooperate. A picture a user actually chose lands under
 * `avatars/` and can never match.
 */
export function isPlatformDefaultAvatar(value) {
  if (!value || typeof value !== 'string') return false;
  const s = value.trim().toLowerCase();
  if (!s) return false;
  return (
    s.includes('default_avatar') ||
    // The stored backend default, at any version.
    /(^|\/)defaults\/profile-avatar(-v\d+)?\.webp$/.test(s) ||
    // Legacy: initials avatars were once used as the "no picture" stand-in.
    s.includes('api.dicebear.com/7.x/initials')
  );
}
