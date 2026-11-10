import { getMediaUrl, deriveThumbnailKey } from '@shared/api/apiClient';
import { directPublicMediaUrl } from '@core/api/media';
import { config } from '@config';
import { resolveCommunityCover } from '@shared/utils/community';

/**
 * Direct thumbnail addresses the public host did not have (older uploads have
 * no thumbnail). Remembered for the session so the miss is paid once.
 */
const missingThumbs = new Set();

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
  if (typeof url === 'string' && url.includes('_thumb.')) missingThumbs.add(url);
}

export const hasDrawnCover = (key) => drawn.has(key);
export const noteCoverDrawn = (key) => { drawn.add(key); };
