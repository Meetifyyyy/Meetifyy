import { useMemo, useState } from 'react';
import { getProcessedAvatarUrl } from '@shared/components/avatar/Avatar';

/**
 * A person's photo, or their initial when there is none.
 *
 * `avatar` is a storage object key rather than a URL, so it goes through the
 * app's shared resolver. The default silhouette is treated as "no photo":
 * an initial on the app's blue reads better at every size Instant Match uses.
 */
export default function Face({ avatar, name, size = 44, className = '', style }) {
  const [failed, setFailed] = useState(false);
  const resolved = useMemo(() => getProcessedAvatarUrl(avatar), [avatar]);
  const hasPhoto = Boolean(resolved) && !resolved.includes('default_avatar');
  const sizing = { '--im-face-size': `${size}px`, ...style };

  if (hasPhoto && !failed) {
    return (
      <img
        className={`im-face ${className}`}
        style={sizing}
        src={resolved}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span className={`im-face ${className}`} style={sizing} aria-hidden="true">
      {(name || '?').trim().charAt(0).toUpperCase()}
    </span>
  );
}

export function firstName(full) {
  if (!full || typeof full !== 'string') return '';
  return full.trim().split(/\s+/)[0];
}
