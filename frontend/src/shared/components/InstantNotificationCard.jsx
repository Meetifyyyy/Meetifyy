import React, { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import Avatar from './avatar/Avatar';

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
  const [isDismissing, setIsDismissing] = useState(false);
  const dragDistanceRef = useRef(0);

  const displayName = isGroup ? groupName : actorName || name;
  const displayAvatar = avatar;

  const handleDragEnd = (_, info) => {
    dragDistanceRef.current = Math.abs(info.offset.x);
    // Swiped right past 60px or with flick velocity > 250
    if (info.offset.x > 60 || info.velocity.x > 250) {
      setIsDismissing(true);
      setTimeout(() => {
        onDismiss?.();
      }, 150);
    }
  };

  const handleClick = (e) => {
    // If the user dragged, don't trigger the click navigation
    if (dragDistanceRef.current > 8 || isDismissing) {
      dragDistanceRef.current = 0;
      return;
    }
    onClick?.(e);
  };

  return (
    <motion.div
      drag="x"
      dragDirectionLock
      dragConstraints={{ left: 0, right: 350 }}
      dragElastic={{ left: 0.05, right: 0.8 }}
      onDragStart={() => {
        dragDistanceRef.current = 0;
      }}
      onDragEnd={handleDragEnd}
      animate={{
        x: isDismissing ? 400 : 0,
        opacity: isDismissing ? 0 : 1,
      }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      onClick={handleClick}
      whileHover={{ scale: 1.01 }}
      whileTap={{ cursor: 'grabbing' }}
      style={{
        background: 'var(--color-bg-white, #ffffff)',
        border: '1px solid var(--color-border, #e2e8f0)',
        boxShadow: '0 12px 32px -4px rgba(0, 0, 0, 0.12), 0 4px 12px -2px rgba(0, 0, 0, 0.06)',
        borderRadius: '16px',
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        width: '360px',
        maxWidth: 'calc(100vw - 32px)',
        margin: '0 auto',
        boxSizing: 'border-box',
        cursor: 'grab',
        fontFamily: 'var(--font-family-sans, sans-serif)',
        touchAction: 'pan-y',
        userSelect: 'none',
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
