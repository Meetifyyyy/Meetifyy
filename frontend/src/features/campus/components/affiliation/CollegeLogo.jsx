import { useState } from 'react';
import { getMediaUrl } from '@shared/api/apiClient';
import styles from './CampusAffiliation.module.css';

function initialsOf(name = '') {
  const words = String(name).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
}

/** A college's logo, or its initials when it has none (or the image fails). */
export default function CollegeLogo({ name, logoUrl, large = false, className = '' }) {
  const [failed, setFailed] = useState(false);
  const src = logoUrl && !failed ? getMediaUrl(logoUrl) : '';
  return (
    <span className={`${styles.logo} ${large ? styles.logoLarge : ''} ${className}`} aria-hidden="true">
      {src ? (
        <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
      ) : (
        initialsOf(name)
      )}
    </span>
  );
}
