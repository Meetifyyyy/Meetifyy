import { useState, useRef, useCallback } from 'react';
import Avatar from './avatar/Avatar';
import CalendarIcon from './ui/CalendarIcon';
import { useIsMobile } from '../hooks/useIsMobile';
import { DEFAULT_ACTIVITY_COVERS, getDefaultActivityCover } from '../utils/activityCover';
import styles from './InstantNotificationCard.module.css';

export default function InstantNotificationCard({
  avatar,
  name,
  isGroup = false,
  isActivity = false,
  groupName,
  actorName,
  bodyText,
  subText,
  thumbnail,
  time = 'just now',
  joinerAvatar: _joinerAvatar,
  activityDate,
  onClick,
  onDismiss,
}) {
  const isMobile = useIsMobile();
  const [dismissed, setDismissed] = useState(false);
  const touchStartXRef = useRef(0);
  const touchDeltaXRef = useRef(0);
  const cardRef = useRef(null);

  const displayName = isGroup ? groupName : actorName || name;
  const displayAvatar = avatar;

  const handleTouchStart = useCallback((e) => {
    touchStartXRef.current = e.touches[0].clientX;
    touchDeltaXRef.current = 0;
  }, []);

  const handleTouchMove = useCallback((e) => {
    const deltaX = e.touches[0].clientX - touchStartXRef.current;
    touchDeltaXRef.current = deltaX;
    if (cardRef.current && Math.abs(deltaX) > 8) {
      cardRef.current.style.transform = `translateX(${deltaX}px)`;
      cardRef.current.style.opacity = `${Math.max(0.2, 1 - Math.abs(deltaX) / 250)}`;
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    const deltaX = touchDeltaXRef.current;
    if (Math.abs(deltaX) > 75) {
      setDismissed(true);
      if (cardRef.current) {
        cardRef.current.style.transition = 'transform 0.2s ease-out, opacity 0.2s ease-out';
        cardRef.current.style.transform = `translateX(${deltaX > 0 ? 350 : -350}px)`;
        cardRef.current.style.opacity = '0';
      }
      setTimeout(() => {
        onDismiss?.();
      }, 200);
    } else if (cardRef.current) {
      cardRef.current.style.transition = 'transform 0.2s ease-out, opacity 0.2s ease-out';
      cardRef.current.style.transform = 'translateX(0)';
      cardRef.current.style.opacity = '1';
      setTimeout(() => {
        if (cardRef.current) cardRef.current.style.transition = '';
      }, 200);
    }
    touchDeltaXRef.current = 0;
  }, [onDismiss]);

  const handleClick = useCallback((e) => {
    if (Math.abs(touchDeltaXRef.current) > 10 || dismissed) {
      return;
    }
    onClick?.(e);
  }, [dismissed, onClick]);

  return (
    <div
      ref={cardRef}
      className={styles.card}
      role="status"
      aria-live="polite"
      onTouchStart={isMobile ? handleTouchStart : undefined}
      onTouchMove={isMobile ? handleTouchMove : undefined}
      onTouchEnd={isMobile ? handleTouchEnd : undefined}
      onClick={handleClick}
    >
      <div className={styles.avatarWrap}>
        {isActivity ? (
          <>
            <img
              src={displayAvatar || getDefaultActivityCover(displayName)}
              alt=""
              onError={(e) => {
                e.target.onerror = null;
                e.target.src = DEFAULT_ACTIVITY_COVERS[0];
              }}
              className={styles.activityCover}
            />
            <div className={styles.calendarBadge}>
              <CalendarIcon
                date={activityDate}
                size="badge"
                style={{ border: '2px solid var(--color-bg-white, #ffffff)', boxShadow: 'none' }}
              />
            </div>
          </>
        ) : (
          <Avatar
            src={displayAvatar}
            name={displayName}
            size="42px"
            isGroup={isGroup}
          />
        )}
      </div>

      <div className={styles.content}>
        <div className={styles.headerRow}>
          <strong className={styles.title}>
            {displayName}
          </strong>
          <span className={styles.time}>
            {time}
          </span>
        </div>

        <div className={styles.body}>
          {isGroup && actorName ? (
            <>
              <span className={styles.actorPrefix}>{actorName}:</span>{' '}
              {bodyText}
            </>
          ) : (
            bodyText
          )}
        </div>

        {subText ? (
          <div className={styles.subText}>
            {subText}
          </div>
        ) : null}
      </div>

      {thumbnail ? (
        <img
          src={thumbnail}
          alt=""
          className={styles.thumbnail}
        />
      ) : null}
    </div>
  );
}
