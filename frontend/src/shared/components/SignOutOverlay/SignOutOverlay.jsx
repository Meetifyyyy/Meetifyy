import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  useSignOutState,
  startSignOutReveal,
  endSignOut,
  SIGN_OUT_COVER_FADE_MS,
} from '@shared/lib/signOutFlow';
import styles from './SignOutOverlay.module.css';

/** The card stays up at least this long, so a fast sign-out does not flash it. */
const MIN_VISIBLE_MS = 650;
/** A destination that never reports ready still gets revealed. */
const DESTINATION_TIMEOUT_MS = 4000;

/**
 * The "Logging out" cover (see shared/lib/signOutFlow). Mounted once, inside
 * the router, so it can navigate; AuthContext drives it.
 *
 * The cover is the page's own colour, opaque, with a centred card: everything
 * that happens while it is up — the signed-in tree unmounting, the route guard
 * redirecting, the signed-out chunk loading — is never seen.
 */
export default function SignOutOverlay({ preloadDestination }) {
  const { phase, target, destinationReady, startedAt } = useSignOutState();
  const navigate = useNavigate();
  const navigatedRef = useRef(false);

  // Fetch the signed-out screen's code while the caches are being cleared.
  useEffect(() => {
    if (phase === 'covering') {
      navigatedRef.current = false;
      try { void Promise.resolve(preloadDestination?.()).catch(() => {}); } catch { /* best effort */ }
    }
  }, [phase, preloadDestination]);

  useEffect(() => {
    if (phase !== 'navigating' || navigatedRef.current) return;
    navigatedRef.current = true;
    navigate(target, { replace: true });
  }, [phase, target, navigate]);

  // Reveal once the destination has painted (or it took too long), and not
  // before the card has been readable.
  useEffect(() => {
    if (phase !== 'navigating') return undefined;
    const wait = Math.max(0, MIN_VISIBLE_MS - (Date.now() - startedAt));
    if (destinationReady) {
      const t = setTimeout(startSignOutReveal, wait);
      return () => clearTimeout(t);
    }
    const t = setTimeout(startSignOutReveal, Math.max(wait, DESTINATION_TIMEOUT_MS));
    return () => clearTimeout(t);
  }, [phase, destinationReady, startedAt]);

  useEffect(() => {
    if (phase !== 'revealing') return undefined;
    const t = setTimeout(endSignOut, SIGN_OUT_COVER_FADE_MS + 40);
    return () => clearTimeout(t);
  }, [phase]);

  if (phase === 'idle' || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={styles.cover}
      data-phase={phase}
      role="alertdialog"
      aria-modal="true"
      aria-live="assertive"
      aria-label="Logging out"
    >
      <div className={styles.card}>
        <span className={`spinner ${styles.spinner}`} aria-hidden="true" />
        <p className={styles.label}>Logging out…</p>
      </div>
    </div>,
    document.body,
  );
}
