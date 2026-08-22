import { getMediaUrl } from '@shared/api/apiClient';

export function isImageUrl(str) {
  if (!str || typeof str !== 'string') return false;
  const s = str.trim().toLowerCase();
  return (
    s.startsWith('/') ||
    s.startsWith('http://') ||
    s.startsWith('https://') ||
    s.startsWith('data:') ||
    s.startsWith('blob:') ||
    s.startsWith('src/') ||
    s.startsWith('assets/') ||
    s.includes('default_avatar') ||
    s.endsWith('.webp') ||
    s.endsWith('.png') ||
    s.endsWith('.jpg') ||
    s.endsWith('.jpeg') ||
    s.endsWith('.svg') ||
    s.endsWith('.gif')
  );
}

/**
 * Resolve a community's avatar to a URL an `<img src>` can actually load, or
 * null when the community has no picture and the caller should fall back to its
 * colour and initial.
 *
 * Two things went wrong without this, and both produced "the community avatar
 * doesn't load here but does over there":
 *
 *  - The stored value is an object key like `community-icons/<uuid>.webp`, not
 *    a path. Dropped straight into `src` it resolves relative to whatever route
 *    the user happens to be on — `/crew/community-icons/<uuid>.webp` — so the
 *    same avatar loaded on one screen and 404'd on the next. `getMediaUrl` is
 *    what turns a key into `/api/media/<key>` against the API origin.
 *  - The image lives under `avatarKey`; `avatar` is only sometimes populated.
 *    Reading one field and not the other missed it entirely.
 *
 * The short-string guard keeps a legacy row that stored a bare initial ("H")
 * from being turned into a media request for a file named "H".
 */
export function resolveCommunityAvatar(community) {
  const raw = community?.avatarKey || community?.avatar;
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length <= 2) return null;
  if (!isImageUrl(trimmed)) return null;
  return getMediaUrl(trimmed);
}
