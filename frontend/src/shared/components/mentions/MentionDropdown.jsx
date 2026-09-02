import { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { getProcessedAvatarUrl } from '@shared/components/avatar/Avatar';
import styles from './MentionDropdown.module.css';

function DropdownContent({ suggestions, loading, selectedIndex, onSelect, position, containerRef }) {
  const isUpwards = position?.bottom !== 'auto' && position?.bottom !== undefined;

  // Strip the internal `fixed` flag — the CSS always uses position:fixed now
  const { fixed: _fixed, ...stylePos } = position || {};

  if (loading && (!suggestions || suggestions.length === 0)) {
    return (
      <div
        className={`${styles.dropdown} ${isUpwards ? styles.upwards : ''}`}
        style={stylePos}
        ref={containerRef}
      >
        <div className={styles.loadingRow}>
          <span className={styles.spinner} />
          <span>Searching...</span>
        </div>
      </div>
    );
  }

  if (!suggestions || suggestions.length === 0) {
    return (
      <div
        className={`${styles.dropdown} ${isUpwards ? styles.upwards : ''}`}
        style={stylePos}
        ref={containerRef}
      >
        <div className={styles.empty}>No matching users found</div>
      </div>
    );
  }

  return (
    <div
      className={`${styles.dropdown} ${isUpwards ? styles.upwards : ''}`}
      style={stylePos}
      ref={containerRef}
    >
      {suggestions.map((user, idx) => {
        const isSelected = idx === selectedIndex;
        const processedAvatar = getProcessedAvatarUrl(user.avatar);
        return (
          <button
            key={user.id || user.username}
            type="button"
            className={`${styles.item} ${isSelected ? styles.selected : ''}`}
            onClick={() => onSelect(user)}
            // Prevent the editor from losing focus/selection on tap without
            // blocking native touch-scroll on the dropdown's own container
            // (a `touchstart preventDefault` on the container would).
            onPointerDown={(e) => e.preventDefault()}
          >
            <div className={styles.avatar}>
              <img src={processedAvatar} alt={user.displayName} className={styles.avatarImg}  onError={(e) => { e.target.onerror = null; e.target.src = '/default_avatar.svg'; }} />
            </div>

            <div className={styles.info}>
              <div className={styles.nameRow}>
                <span className={styles.displayName}>{user.displayName}</span>
              </div>
              <span className={styles.username}>@{user.username}</span>
              {user.mutualCount > 0 && (
                <span className={styles.mutuals}>
                  {user.mutualCount} mutual connection{user.mutualCount > 1 ? 's' : ''}
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

export default function MentionDropdown({ suggestions, loading, selectedIndex, onSelect, position, onClose }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (containerRef.current && selectedIndex >= 0) {
      const selectedEl = containerRef.current.children[selectedIndex];
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [selectedIndex]);

  return ReactDOM.createPortal(
    <DropdownContent
      suggestions={suggestions}
      loading={loading}
      selectedIndex={selectedIndex}
      onSelect={onSelect}
      position={position}
      containerRef={containerRef}
    />,
    document.body
  );
}
