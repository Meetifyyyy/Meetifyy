import { getMediaUrl, deriveThumbnailKey } from '@shared/api/apiClient';
import { directPublicMediaUrl } from '@core/api/media';
import { config } from '@config';
import { resolveCommunityCover } from '@shared/utils/community';

/**
 * Direct thumbnail addresses the public host did not have (older uploads have
 * no thumbnail). Remembered across launches (a file that was never made will
 * not appear later), so the failed request before the real picture is paid
 * once on this device, not once per session.
 */
const MISSING_KEY = 'meetifyy_missing_cover_thumbs_v1';
const MAX_MISSING = 300;
const missingThumbs = new Set((() => {
  try {
    const list = JSON.parse(localStorage.getItem(MISSING_KEY) || '[]');
    return Array.isArray(list) ? list.slice(-MAX_MISSING) : [];
  } catch {
    return [];
  }
})());

/** Covers this session has already drawn, so a card that mounts again need not wait. */
const drawn = new Set();

const direct = (apiUrl) => directPublicMediaUrl(apiUrl, config.storage?.publicUrl);

/**
 * Where to load a community's cover from, best first, for the card's blurred
 * background. A thumbnail is plenty for a picture that is blurred and stretched
 * (and a fraction of the bytes of the original): the thumbnail straight from the
 * public host (year-long immutable caching, so it also works offline), then the
 * original from there, then the API's thumbnail address, which redirects to the
 * original when there is no thumbnail. Empty when the community has no cover.
 */
export function coverSources(community) {
  const full = resolveCommunityCover(community);
  if (!full) return [];
  const thumbKey = deriveThumbnailKey(full);
  const apiThumb = thumbKey ? getMediaUrl(thumbKey) : null;
  const directThumb = apiThumb ? direct(apiThumb) : null;
  const list = [
    directThumb && !missingThumbs.has(directThumb) ? directThumb : null,
    direct(full),
    apiThumb || full,
  ].filter(Boolean);
  return [...new Set(list)];
}

/** A source that failed: if it was a direct thumbnail, do not offer it again. */
export function noteCoverSourceError(url) {
  if (typeof url !== 'string' || !url.includes('_thumb.')) return;
  // Offline, every request fails: that says nothing about the file.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  missingThumbs.add(url);
  try {
    localStorage.setItem(MISSING_KEY, JSON.stringify([...missingThumbs].slice(-MAX_MISSING)));
  } catch {
    // Storage full: remembered for this session only.
  }
}

/** Covers already asked for, so a list that re-renders does not ask again. */
const warming = new Set();

/**
 * Starts every listed community's cover downloading at once, as soon as the
 * list has its data, instead of each card asking only when it is near the
 * screen. Only the first (smallest) source: the thumbnail where there is one.
 * By the time a card draws, its picture is in the browser's cache, so cards
 * with a cover appear together with the rest rather than after them.
 */
export function warmCommunityCovers(communities) {
  if (!Array.isArray(communities) || typeof Image === 'undefined') return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  for (const community of communities.slice(0, 40)) {
    const first = coverSources(community)[0];
    if (!first || warming.has(first) || drawn.has(first)) continue;
    warming.add(first);
    const img = new Image();
    img.decoding = 'async';
    img.onerror = () => noteCoverSourceError(first);
    img.src = first;
  }
}

export const hasDrawnCover = (key) => drawn.has(key);
export const noteCoverDrawn = (key) => { drawn.add(key); };
