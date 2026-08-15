import React, { useState, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import Avatar from './avatar/Avatar';
import { useIsMobile } from '../hooks/useIsMobile';

export default function InstantNotificationCard({
  avatar,
  name,
  isGroup = false,
  groupName,
  actorName,
  bodyText,
  time = 'just now',
  onClick,
  onDismiss,
}) {
  const isMobile = useIsMobile();
  const [dismissDirection, setDismissDirection] = useState(null);
  const dragDistanceRef = useRef(0);

  const displayName = isGroup ? groupName : actorName || name;
  const displayAvatar = avatar;

  const handleDragStart = useCallback(() => {
    dragDistanceRef.current = 0;
  }, []);

  const handleDragEnd = useCallback((_, info) => {
    const offsetX = info.offset.x;
    const velocityX = info.velocity.x;
    dragDistanceRef.current = Math.abs(offsetX);

    // Sensible threshold for mobile swipe-to-dismiss:
    // Distance > 60px or flick velocity > 250 px/s in either direction
    if (offsetX > 60 || velocityX > 250) {
      setDismissDirection('right');
      setTimeout(() => {
        onDismiss?.();
      }, 180);
    } else if (offsetX < -60 || velocityX < -250) {
      setDismissDirection('left');
      setTimeout(() => {
        onDismiss?.();
      }, 180);
    }
  }, [onDismiss]);

  const handleClick = useCallback((e) => {
    // If the user performed a drag gesture on mobile, suppress the click navigation
    if (isMobile && (dragDistanceRef.current > 8 || dismissDirection)) {
      dragDistanceRef.current = 0;
      return;
    }
    onClick?.(e);
  }, [isMobile, dismissDirection, onClick]);

  const screenWidth = typeof window !== 'undefined' ? window.innerWidth : 400;
  const exitX = screenWidth + 80;

  return (
    <motion.div
      drag={isMobile ? 'x' : false}
      dragDirectionLock={isMobile}
      dragConstraints={isMobile ? { left: 0, right: 0 } : undefined}
      dragElastic={isMobile ? 1.0 : undefined}
      onDragStart={isMobile ? handleDragStart : undefined}
      onDragEnd={isMobile ? handleDragEnd : undefined}
      animate={{
        x: dismissDirection === 'right' ? exitX : dismissDirection === 'left' ? -exitX : 0,
        opacity: dismissDirection ? 0 : 1,
      }}
      transition={{ type: 'spring', stiffness: 420, damping: 28, mass: 0.6 }}
      onClick={handleClick}
      whileHover={!isMobile ? { scale: 1.015 } : undefined}
      whileTap={{ scale: 0.985 }}
      style={{
        background: 'var(--color-bg-white, #ffffff)',
        border: '1px solid var(--color-border, #e2e8f0)',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.06), 0 2px 6px rgba(0, 0, 0, 0.03)',
        borderRadius: '16px',
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        width: '360px',
        maxWidth: 'calc(100vw - 24px)',
        margin: '0 auto',
        boxSizing: 'border-box',
        cursor: isMobile ? 'default' : 'pointer',
        fontFamily: 'var(--font-family-sans, sans-serif)',
        touchAction: isMobile ? 'pan-y' : 'auto',
        userSelect: 'none',
        overflow: 'hidden',
      }}
    >
      <div style={{ flexShrink: 0 }}>
        <Avatar
          src={displayAvatar}
          name={displayName}
          size="40px"
          isGroup={isGroup}
        />
      </div>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', width: '100%' }}>
          <strong
            style={{
              color: 'var(--color-text-main, #0f172a)',
              fontWeight: 700,
              fontSize: '0.86rem',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {displayName}
          </strong>
          <span style={{ fontSize: '0.72rem', color: 'var(--color-text-light, #94a3b8)', fontWeight: 500, flexShrink: 0 }}>
            {time}
          </span>
        </div>

        <div
          style={{
            fontSize: '0.83rem',
            color: 'var(--color-text-muted, #475569)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {isGroup && actorName ? (
            <>
              <span style={{ fontWeight: 600, color: 'var(--color-text-main, #0f172a)' }}>{actorName}:</span>{' '}
              {bodyText}
            </>
          ) : (
            bodyText
          )}
        </div>
      </div>
    </motion.div>
  );
}
