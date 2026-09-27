import { memo, useState } from 'react';
import { resolveCommunityAvatarThumb } from '@shared/utils/avatar';
import styles from './CommunityAvatar.module.css';

/**
 * A community's icon at a fixed size, falling back to its initial on its
 * colour. The size is set in CSS pixels so a row never shifts when the image
 * arrives.
 */
function CommunityAvatar({ community, size = 48 }) {
  const src = resolveCommunityAvatarThumb(community);
  const [failedSrc, setFailedSrc] = useState(null);
  const showImage = src && failedSrc !== src;
  const initial = (community?.name || '?').trim().charAt(0).toUpperCase();

  return (
    <span
      className={styles.avatar}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.42),
        background: showImage ? undefined : community?.color || 'var(--color-primary)',
      }}
      aria-hidden="true"
    >
      {showImage ? (
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          onError={() => setFailedSrc(src)}
        />
      ) : (
        initial
      )}
    </span>
  );
}

export default memo(CommunityAvatar);
