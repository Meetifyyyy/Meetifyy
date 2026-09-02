import React, { useState } from 'react';
import { getMediaUrl } from '../api/apiClient';

/**
 * True when a stored avatar value is the platform's own placeholder rather
 * than a picture the user chose.
 *
 * An account that never picked an avatar does not have an empty `avatar`
 * field — the API writes a real media reference to the bundled default onto
 * it. Any check that only tests for null therefore treats those accounts as
 * having a picture, which is why the admin tables used to render them by
 * fetching the placeholder over the network instead of drawing the default.
 *
 * Mirrors `isPlatformDefaultAvatar` in the main app
 * (`frontend/src/shared/constants/defaultAvatar.js`). A picture a user chose
 * lands under `avatars/` and can never match.
 */
export function isPlatformDefaultAvatar(value?: string | null): boolean {
  if (!value || typeof value !== 'string') return false;
  const s = value.trim().toLowerCase();
  if (!s) return false;
  return (
    s.includes('default_avatar') ||
    /(^|\/)defaults\/profile-avatar(-v\d+)?\.webp$/.test(s) ||
    s.includes('api.dicebear.com/7.x/initials')
  );
}

/**
 * The blue default avatar, drawn inline — the same artwork the main app and
 * the API use, so an account with no picture looks identical in both places.
 * Inline rather than an <img> so the fallback needs no network request and
 * cannot itself fail to load.
 */
function DefaultAvatarGlyph({ size }: { size: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      style={{ width: size, height: size, borderRadius: '50%', display: 'block', flexShrink: 0 }}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="12" fill="#1d68f7" />
      <circle cx="12" cy="8.5" r="2.5" fill="#ffffff" />
      <path fill="#ffffff" d="M7 16.3c0-2.5 2.2-4.5 5-4.5s5 2 5 4.5c0 1.2-2.2 1.8-5 1.8s-5-0.6-5-1.8z" />
    </svg>
  );
}

/**
 * One avatar for every admin table.
 *
 * This replaces three near-identical copies (users, campus reps, verification)
 * that each resolved the URL themselves and each fell back to a coloured
 * initial — so the portal showed a different placeholder from the product for
 * the same account, and any fix had to be made three times.
 */
const UserAvatar: React.FC<{ user: any; size?: number }> = ({ user, size = 26 }) => {
  const [imgError, setImgError] = useState(false);

  const raw = user?.avatar;
  const avatarUrl = isPlatformDefaultAvatar(raw) ? null : getMediaUrl(raw);

  if (!avatarUrl || imgError) {
    return <DefaultAvatarGlyph size={size} />;
  }

  return (
    <img
      src={avatarUrl}
      alt={user?.displayName || user?.username || 'Avatar'}
      onError={() => setImgError(true)}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        objectFit: 'cover',
        border: '1px solid var(--color-border)',
        flexShrink: 0,
      }}
    />
  );
};

export default UserAvatar;
