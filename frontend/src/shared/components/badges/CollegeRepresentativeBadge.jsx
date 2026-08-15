import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import styles from './CollegeRepresentativeBadge.module.css';

/** Detects if the primary pointer can hover (mouse/trackpad), not touch */
const canHover = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(hover: hover) and (pointer: fine)').matches;

const POPUP_MARGIN = 12; // safe margin from screen edges in px

/**
 * College Representative Badge
 * - Mouse devices  → popup appears on hover, disappears on mouse-leave
 * - Touch devices  → popup appears on tap, dismisses on outside-tap or Escape
 * - Popup auto-flips (top/bottom) and stays 100% visible inside viewport bounds
 */
export const CollegeRepresentativeBadge = ({ isCampusRep, collegeName, size = 'sm', className = '' }) => {
  const [open, setOpen] = useState(false);
  const [popupPos, setPopupPos] = useState({ top: -9999, left: -9999, arrowLeft: 0, placement: 'top' });
  const badgeRef = useRef(null);
  const popupRef = useRef(null);
  const hoverTimeout = useRef(null);

  if (!isCampusRep) return null;

  const label = collegeName ? `${collegeName} Representative` : 'College Representative';

  const updatePosition = useCallback(() => {
    if (!badgeRef.current || !popupRef.current) return;

    const badgeRect = badgeRef.current.getBoundingClientRect();
    const popupRect = popupRef.current.getBoundingClientRect();
    const scrollX = window.scrollX || window.pageXOffset || 0;
    const scrollY = window.scrollY || window.pageYOffset || 0;
    const clientWidth = document.documentElement.clientWidth || window.innerWidth;

    const badgeCenter = badgeRect.left + badgeRect.width / 2 + scrollX;
    const popupWidth = popupRect.width;
    const popupHeight = popupRect.height;

    // 1. Horizontal positioning: clamp within viewport
    const minLeft = scrollX + POPUP_MARGIN;
    const maxLeft = scrollX + Math.max(POPUP_MARGIN, clientWidth - popupWidth - POPUP_MARGIN);
    const targetLeft = badgeCenter - popupWidth / 2;
    const clampedLeft = Math.max(minLeft, Math.min(targetLeft, maxLeft));

    // 2. Vertical positioning: auto-flip if not enough room above badge
    const fitsAbove = badgeRect.top >= popupHeight + 16;
    let popupTop;
    let placement;

    if (fitsAbove) {
      popupTop = badgeRect.top + scrollY - popupHeight - 8;
      placement = 'top';
    } else {
      popupTop = badgeRect.bottom + scrollY + 8;
      placement = 'bottom';
    }

    // 3. Arrow position: tracks badge horizontally
    const rawArrowLeft = badgeCenter - clampedLeft;
    const arrowMargin = 16;
    const clampedArrowLeft = Math.max(arrowMargin, Math.min(rawArrowLeft, popupWidth - arrowMargin));

    setPopupPos({
      top: popupTop,
      left: clampedLeft,
      arrowLeft: clampedArrowLeft,
      placement,
    });
  }, []);

  const openPopup = () => {
    setOpen(true);
  };

  const closePopup = () => setOpen(false);

  // Position calculation on open & on window resize/scroll
  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();

    const handleResize = () => updatePosition();
    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleResize, true);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleResize, true);
    };
  }, [open, updatePosition]);

  // Mouse device handlers
  const handleMouseEnter = () => {
    if (!canHover()) return;
    clearTimeout(hoverTimeout.current);
    openPopup();
  };

  const handleMouseLeave = () => {
    if (!canHover()) return;
    hoverTimeout.current = setTimeout(closePopup, 120);
  };

  const handlePopupMouseEnter = () => {
    if (!canHover()) return;
    clearTimeout(hoverTimeout.current);
  };

  const handlePopupMouseLeave = () => {
    if (!canHover()) return;
    hoverTimeout.current = setTimeout(closePopup, 120);
  };

  // Touch / click handler
  const handleClick = (e) => {
    if (canHover()) return;
    e.stopPropagation();
    e.preventDefault();
    if (open) { closePopup(); return; }
    openPopup();
  };

  // Close on outside click/tap or Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (
        popupRef.current && !popupRef.current.contains(e.target) &&
        badgeRef.current && !badgeRef.current.contains(e.target)
      ) closePopup();
    };
    const onKey = (e) => { if (e.key === 'Escape') closePopup(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => () => clearTimeout(hoverTimeout.current), []);

  const popup = open ? (
    <div
      ref={popupRef}
      className={styles.popup}
      style={{
        top: `${popupPos.top}px`,
        left: `${popupPos.left}px`,
        visibility: popupPos.top === -9999 ? 'hidden' : 'visible',
      }}
      onMouseEnter={handlePopupMouseEnter}
      onMouseLeave={handlePopupMouseLeave}
      onClick={(e) => e.stopPropagation()}
    >
      <div className={styles.popupInner}>
        <img
          src="/icons/representative_badge.webp"
          alt=""
          className={styles.popupBadgeImg}
          draggable={false}
        />
        <div className={styles.popupText}>
          <span className={styles.popupTitle}>{label}</span>
          <span className={styles.popupSub}>Verified campus representative</span>
        </div>
        <div
          className={popupPos.placement === 'bottom' ? styles.popupArrowBottom : styles.popupArrowTop}
          style={{ left: `${popupPos.arrowLeft}px` }}
        />
      </div>
    </div>
  ) : null;

  return (
    <>
      <span
        ref={badgeRef}
        className={`${styles.badgeWrapper} ${styles[size]} ${className}`}
        aria-label={label}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPopup(); } }}
      >
        <img
          src="/icons/representative_badge.webp"
          alt="College Representative"
          className={styles.svg}
          draggable={false}
        />
      </span>
      {typeof document !== 'undefined' && createPortal(popup, document.body)}
    </>
  );
};
