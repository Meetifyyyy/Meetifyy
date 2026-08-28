import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { X, Lock, Shield, RefreshCw } from '@shared/components/icons';
import { useCookieConsent } from '@shared/context/CookieConsentContext';
import { useScrollLock } from '@shared/hooks/useScrollLock';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';
import styles from './CookieBanner.module.css';

/** Cookie icon - clean custom SVG */
function CookieIcon({ size = 15 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <circle cx="8"  cy="10" r="1"   fill="currentColor" stroke="none" />
      <circle cx="14" cy="8"  r="1"   fill="currentColor" stroke="none" />
      <circle cx="9"  cy="15" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="15" cy="14" r="1"   fill="currentColor" stroke="none" />
      <path d="M19 5c-1 0-2-.4-2.7-1" />
    </svg>
  );
}

/* ─────────────────────────────────────────────────────────────
   Storage categories - user-focused plain language
   No em dashes used anywhere in this file
   ───────────────────────────────────────────────────────────── */
const CATEGORIES = [
  {
    id: 'auth',
    icon: Lock,
    name: 'Essential Authentication & Security',
    description:
      'Keeps you signed in, protects your account, supports password recovery, and remembers necessary navigation state.',
  },
  {
    id: 'functional',
    icon: Shield,
    name: 'Functional Application Storage',
    description:
      'Remembers your preferences and settings to provide a more consistent experience.',
  },
  {
    id: 'performance',
    icon: RefreshCw,
    name: 'Offline & Performance Storage',
    description:
      'Helps Meetifyy load faster, support offline features, and reduce unnecessary network requests.',
  },
];

/* ─────────────────────────────────────────────────────────────
   Storage Preferences Modal
   ───────────────────────────────────────────────────────────── */
export function CookiePreferencesModal() {
  const { preferencesOpen, closePreferences } = useCookieConsent();
  const closeRef = useRef(null);

  // Focus close button on open
  useEffect(() => {
    if (preferencesOpen) {
      setTimeout(() => closeRef.current?.focus(), 50);
    }
  }, [preferencesOpen]);

  // Back button and Escape dismiss the overlay
  useOverlayBack(preferencesOpen, closePreferences);
  useScrollLock(preferencesOpen);

  useEffect(() => {
    if (!preferencesOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') closePreferences(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [preferencesOpen, closePreferences]);

  if (!preferencesOpen) return null;

  return createPortal(
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="How Meetifyy Uses Storage"
      onClick={(e) => { if (e.target === e.currentTarget) closePreferences(); }}
    >
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.modalHeader}>
          <div className={styles.headerLeft}>
            <div className={styles.headerIconWrap} aria-hidden="true">
              <CookieIcon size={16} />
            </div>
            <div>
              <h2 className={styles.modalTitle}>How Meetifyy Uses Storage</h2>
              <p className={styles.modalSubtitle}>Essential and functional storage. No advertising or analytics tracking.</p>
            </div>
          </div>
          <button
            ref={closeRef}
            className={styles.closeBtn}
            onClick={closePreferences}
            aria-label="Close storage information"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className={styles.modalBody}>
          <p className={styles.bodyLead}>
            Meetifyy uses browser storage to keep your account secure, remember preferences,
            and provide features such as offline caching and faster loading. Meetifyy does
            not currently use advertising or analytics tracking.
          </p>

          <div className={styles.categoryList} role="list">
            {CATEGORIES.map(({ id, icon: Icon, name, description }) => (
              <div key={id} className={styles.categoryItem} role="listitem">
                <div className={styles.catHeaderRow}>
                  <div className={styles.catTitleWrap}>
                    <Icon size={14} className={styles.catIcon} aria-hidden="true" />
                    <span className={styles.catName}>{name}</span>
                  </div>
                  <span className={styles.statusActive} aria-label="Always active">
                    Always active
                  </span>
                </div>
                <p className={styles.catDesc}>{description}</p>
              </div>
            ))}
          </div>

          <p className={styles.policyNote}>
            Learn more about the specific technologies and storage we use in our{' '}
            <Link to="/cookie-policy" onClick={closePreferences}>
              Cookie Policy
            </Link>
            .
          </p>
        </div>

        {/* Footer */}
        <div className={styles.modalFooter}>
          <div className={styles.footerLinks}>
            <Link to="/privacy-policy" onClick={closePreferences}>Privacy Policy</Link>
            <span className={styles.footerDot} aria-hidden="true">·</span>
            <Link to="/cookie-policy" onClick={closePreferences}>Cookie Policy</Link>
          </div>
          <button className={styles.gotItBtn} onClick={closePreferences}>
            Got it
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ─────────────────────────────────────────────────────────────
   Compact Cookie & Storage Notice Banner
   Floating bottom-left card on desktop, bottom-docked on mobile
   ───────────────────────────────────────────────────────────── */
export default function CookieBanner() {
  const { hasAcknowledged, acknowledge, openPreferences } = useCookieConsent();

  if (hasAcknowledged) return null;

  return (
    <div className={styles.bannerBackdrop} role="region" aria-label="Privacy notice">
      <div className={styles.banner}>
        <div className={styles.bannerHeader}>
          <div className={styles.bannerTitleGroup}>
            <div className={styles.bannerIconWrap} aria-hidden="true">
              <CookieIcon size={14} />
            </div>
            <h3 className={styles.bannerTitle}>Your privacy matters</h3>
          </div>
          <button
            type="button"
            className={styles.bannerCloseBtn}
            onClick={acknowledge}
            aria-label="Dismiss privacy notice"
          >
            <X size={13} />
          </button>
        </div>

        <p className={styles.bannerDesc}>
          Meetifyy uses essential and functional browser storage to keep your account secure
          and remember your preferences. We do not use advertising or analytics tracking.{' '}
          <button
            type="button"
            className={styles.inlineLink}
            onClick={openPreferences}
          >
            Learn more
          </button>
        </p>

        <div className={styles.bannerActions}>
          <button
            type="button"
            className={styles.prefsBtn}
            onClick={openPreferences}
            aria-label="View storage preferences"
          >
            Preferences
          </button>
          <button
            type="button"
            className={styles.acceptBtn}
            onClick={acknowledge}
            aria-label="Acknowledge and dismiss notice"
          >
            Understood
          </button>
        </div>
      </div>
    </div>
  );
}
