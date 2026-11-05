import { useEffect, useRef, useState } from 'react';
import styles from './ArrivalReveal.module.css';

/**
 * Shows content that arrives after the card is already on screen (a profile's
 * bio and interests load after its avatar, name and counts) by growing its
 * space smoothly and fading it in, instead of the card snapping taller.
 *
 * Content that is already there on the first render shows at once: a profile
 * opened from cache must not animate on every visit.
 */
export default function ArrivalReveal({ show, delay = 0, children }) {
  const presentAtMount = useRef(show);
  const [open, setOpen] = useState(show);

  useEffect(() => {
    if (!show) {
      setOpen(false);
      return undefined;
    }
    if (open) return undefined;
    // One frame closed with the content in place, so the growth transitions.
    let frame = 0;
    const timer = setTimeout(() => {
      frame = requestAnimationFrame(() => setOpen(true));
    }, delay);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [show, delay, open]);

  if (!show) return null;
  return (
    <div
      className={`${styles.reveal} ${open ? styles.open : ''} ${presentAtMount.current ? styles.instant : ''}`}
    >
      <div className={styles.inner}>{children}</div>
    </div>
  );
}
