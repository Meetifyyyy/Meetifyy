import { useRef, useState, useCallback, useEffect } from 'react';
import styles from './PullToRefresh.module.css';

const TRIGGER_DISTANCE = 70; // px of pull needed to release into a refresh
const MAX_PULL = 110;        // visual cap so the drag can't run away
const RESISTANCE = 0.5;      // damping — finger travel != visual travel

/**
 * Native-touch pull-to-refresh, mobile-only (gated to the app's own <=768px
 * breakpoint, matching every other mobile check in this codebase). No library
 * — this is a small, self-contained gesture the project didn't already have.
 *
 * The gesture only arms when the page is already scrolled to the top (so it
 * never fights a normal scroll), and is abandoned if the user scrolls away
 * from the top mid-drag. `onRefresh` is awaited so the indicator holds until
 * the actual refresh settles, then springs back.
 */
export default function PullToRefresh({ onRefresh, children, disabled = false }) {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const containerRef = useRef(null);
  const startYRef = useRef(null);
  const pullingRef = useRef(false);
  const isMobileRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    try {
      const mq = window.matchMedia('(max-width: 768px)');
      const update = () => { isMobileRef.current = mq.matches; };
      update();

      if (typeof mq.addEventListener === 'function') {
        mq.addEventListener('change', update);
      } else if (typeof mq.addListener === 'function') {
        mq.addListener(update);
      }

      return () => {
        if (typeof mq.removeEventListener === 'function') {
          mq.removeEventListener('change', update);
        } else if (typeof mq.removeListener === 'function') {
          mq.removeListener(update);
        }
      };
    } catch (_) {}
  }, []);

  const isAtTop = () => (window.scrollY || document.documentElement.scrollTop || 0) <= 0;

  const endPull = useCallback(async (finalDistance) => {
    pullingRef.current = false;
    startYRef.current = null;

    if (finalDistance >= TRIGGER_DISTANCE) {
      setIsRefreshing(true);
      setPullDistance(TRIGGER_DISTANCE);
      try {
        await onRefresh?.();
      } finally {
        setIsRefreshing(false);
        setPullDistance(0);
      }
    } else {
      setPullDistance(0);
    }
  }, [onRefresh]);

  // touchmove needs a non-passive listener to be able to preventDefault() the
  // native scroll while a pull is in progress — React's JSX onTouchMove prop
  // is attached passively and silently can't do this, so these are wired via
  // a plain DOM listener instead.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let currentDistance = 0;

    const handleTouchStart = (e) => {
      if (disabled || isRefreshing || !isMobileRef.current) return;
      if (!isAtTop()) return;
      startYRef.current = e.touches[0].clientY;
      pullingRef.current = true;
    };

    const handleTouchMove = (e) => {
      if (!pullingRef.current || startYRef.current == null) return;
      const delta = e.touches[0].clientY - startYRef.current;

      if (delta <= 0 || !isAtTop()) {
        // Not actually pulling down, or scrolled away from the top mid-drag —
        // abandon the gesture instead of fighting native scroll.
        pullingRef.current = false;
        currentDistance = 0;
        setPullDistance(0);
        return;
      }

      const damped = Math.min(MAX_PULL, delta * RESISTANCE);
      currentDistance = damped;
      setPullDistance(damped);
      if (delta > 10) e.preventDefault();
    };

    const handleTouchEnd = () => {
      if (!pullingRef.current) return;
      endPull(currentDistance);
      currentDistance = 0;
    };

    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd, { passive: true });
    el.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
      el.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [disabled, isRefreshing, endPull]);

  const progress = Math.min(1, pullDistance / TRIGGER_DISTANCE);

  return (
    <div ref={containerRef} className={styles.wrapper}>
      <div
        className={styles.indicator}
        style={{ opacity: Math.min(1, pullDistance / 24) }}
        aria-hidden="true"
      >
        <div
          className={`${styles.spinner} ${isRefreshing ? styles.spinning : ''}`}
          style={!isRefreshing ? { transform: `rotate(${progress * 360}deg)` } : undefined}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 1 1-3-6.7" />
            <polyline points="21 3 21 9 15 9" />
          </svg>
        </div>
      </div>
      <div
        className={styles.content}
        style={{
          transform: pullDistance > 0 ? `translateY(${pullDistance}px)` : undefined,
          transition: pullingRef.current ? 'none' : 'transform 0.25s cubic-bezier(0.22, 1, 0.36, 1)',
          // Only worth compositing while an actual pull/spring-back is
          // happening — not left on indefinitely for a wrapper that spends
          // almost all of its life completely static.
          willChange: pullDistance > 0 || isRefreshing ? 'transform' : 'auto',
        }}
      >
        {children}
      </div>
    </div>
  );
}
