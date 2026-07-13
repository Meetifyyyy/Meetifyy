import { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { isImageUrl } from '../../../utils/avatar';
import styles from './MentionDropdown.module.css';

function DropdownContent({ suggestions, selectedIndex, onSelect, position, containerRef }) {
  const isUpwards = position?.bottom !== 'auto' && position?.bottom !== undefined;

  // Strip the internal `fixed` flag — the CSS always uses position:fixed now
  const { fixed: _fixed, ...stylePos } = position || {};

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
      onMouseDown={e => e.preventDefault()}
      onTouchStart={e => e.preventDefault()}
    >
      {suggestions.map((user, idx) => {
        const isSelected = idx === selectedIndex;
        return (
          <button
            key={user.id || user.username}
            type="button"
            className={`${styles.item} ${isSelected ? styles.selected : ''}`}
            onClick={() => onSelect(user)}
          >
            <div className={styles.avatar}>
              {isImageUrl(user.avatar) ? (
                <img src={user.avatar} alt={user.displayName} className={styles.avatarImg} />
              ) : (
                <span>{user.displayName ? user.displayName.charAt(0).toUpperCase() : 'U'}</span>
              )}
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

export default function MentionDropdown({ suggestions, selectedIndex, onSelect, position, onClose }) {
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
      selectedIndex={selectedIndex}
      onSelect={onSelect}
      position={position}
      containerRef={containerRef}
    />,
    document.body
  );
}
