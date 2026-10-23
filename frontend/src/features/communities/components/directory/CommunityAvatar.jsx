import { memo, useMemo, useState } from 'react';
import { getMediaUrl, deriveThumbnailKey } from '@shared/api/apiClient';
import { directPublicMediaUrl } from '@core/api/media';
import { config } from '@config';
import { resolveCommunityAvatar } from '@shared/utils/avatar';
import styles from './CommunityAvatar.module.css';

/**
 * Direct thumbnail addresses the public host did not have (older uploads have
 * no thumbnail). Remembered for the session so the miss is paid once.
 */
const missingThumbs = new Set();

const direct = (apiUrl) => directPublicMediaUrl(apiUrl, config.storage?.publicUrl);

/**
 * Where to try the icon from, best first: the thumbnail and then the original
 * straight from the public host, whose year-long caching is what keeps the
 * icon on screen offline, and last the API thumbnail, which redirects to the
 * original when there is no thumbnail. Without a public host it is the API
 * thumbnail alone, as before.
 */
function sourcesFor(community) {
  const full = resolveCommunityAvatar(community);
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

/**
 * A community's icon at a fixed size, falling back to its initial on its
 * colour. The size is set in CSS pixels so a row never shifts when the image
 * arrives.
 */
function CommunityAvatar({ community, size = 48 }) {
  // Keyed on the stored picture only: a refetched community object with the
  // same picture must not restart the fallback chain.
  const picture = community?.avatarKey || community?.avatar;
  const sources = useMemo(() => sourcesFor({ avatarKey: picture }), [picture]);
  // How far down `sources` this icon has had to go, keyed by the list so a
  // different community (or a new picture) starts from the top again.
  const [failed, setFailed] = useState({ key: '', count: 0 });
  const listKey = sources.join('|');
  const tried = failed.key === listKey ? failed.count : 0;
  const src = sources[tried] ?? null;
  const initial = (community?.name || '?').trim().charAt(0).toUpperCase();

  const onError = () => {
    if (src && src.includes('_thumb.') && src === sources[0] && src !== sources[sources.length - 1]) {
      missingThumbs.add(src);
    }
    setFailed({ key: listKey, count: tried + 1 });
  };

  return (
    <span
      className={styles.avatar}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.42),
        background: src ? undefined : community?.color || 'var(--color-primary)',
      }}
      aria-hidden="true"
    >
      {src ? (
        <img
          key={src}
          src={src}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          onError={onError}
        />
      ) : (
        initial
      )}
    </span>
  );
}

export default memo(CommunityAvatar);
