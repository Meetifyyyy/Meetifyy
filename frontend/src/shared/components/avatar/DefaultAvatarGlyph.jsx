/**
 * The blue default avatar, drawn inline.
 *
 * Kept as a component rather than an `<img src="/default_avatar.svg">` so the
 * fallback needs no network request and cannot itself fail to load — the case
 * that produced a broken image where the default was supposed to be. The markup
 * is identical to `public/default_avatar.svg` and to the server's fallback in
 * `backend/src/uploads/default-avatar.ts`; see that file before changing it.
 */
export default function DefaultAvatarGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" style={{ width: '100%', height: '100%', display: 'block' }}>
      <circle cx="12" cy="12" r="12" fill="#1d68f7" />
      <circle cx="12" cy="8.5" r="2.5" fill="#ffffff" />
      <path fill="#ffffff" d="M7 16.3c0-2.5 2.2-4.5 5-4.5s5 2 5 4.5c0 1.2-2.2 1.8-5 1.8s-5-0.6-5-1.8z" />
    </svg>
  );
}
