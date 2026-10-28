import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMediaQuery } from '@shared/hooks/useMediaQuery';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';
import { useSystemBars } from '@shared/hooks/useSystemBars';
import CollegePicker from './CollegePicker';
import CollegeEmailVerify from './CollegeEmailVerify';
import styles from './CampusAffiliation.module.css';

/** The phone layout (the same breakpoint the stylesheet uses). */
const PHONE_QUERY = '(max-width: 768px)';

/** How long the slide takes; the stylesheet's animation is the same length. */
const SLIDE_MS = 300;

/**
 * What Campus shows to someone without a verified college email: pick a
 * college, then verify its email. A code already sent (before a reload or an
 * app restart) comes back from the server as `pending` and resumes on the code
 * step; nothing about it is kept on the device.
 *
 * `pending` / `pendingLoading` come from `useCampusAffiliation({ withPending })`
 * in the page, so the page and this flow read one query.
 *
 * LAYOUT: both steps live in one `.screen`. On a phone the pick step is the
 * whole content area above the bottom navigation (no card, no eyebrow) and the
 * verify step is a screen of its own that slides in from the right over it; the
 * picker stays mounted underneath, so going back lands on the same search and
 * scroll position. From 769px up it is the same bordered container the
 * Notifications page uses, and the verify step takes the place of the list in
 * it, centred, as before.
 *
 * Choosing a college only opens that screen. Nothing is verified, or even
 * sent, until the person enters an address and the code from it.
 */
export default function CampusJoinFlow({ pending = null, pendingLoading = false, onVerified, onCancel }) {
  const isPhone = useMediaQuery(PHONE_QUERY);
  const [college, setCollege] = useState(null);
  const [challenge, setChallenge] = useState(null);
  const [restored, setRestored] = useState(false);
  // The verify screen is on its way out (sliding back to the right).
  const [leaving, setLeaving] = useState(false);
  // Opened by choosing a college (slides in), not by restoring a sent code
  // (already there when the page opens).
  const [slidesIn, setSlidesIn] = useState(false);
  // The verify screen has finished arriving and covers the screen: only then
  // does the page behind it give up the transparent status bar (see below).
  const [verifyShown, setVerifyShown] = useState(false);
  const screenRef = useRef(null);
  const savedScroll = useRef(0);

  // Resume a pending code once, when the server's answer first arrives. Later
  // changes to `pending` (a resend from this screen) are the flow's own doing.
  useEffect(() => {
    if (restored || pendingLoading) return;
    setRestored(true);
    if (pending?.collegeId && !college) {
      setCollege({
        id: pending.collegeId,
        name: pending.collegeName || 'Your college',
        logoUrl: pending.logoUrl,
        domains: pending.domains,
      });
      setChallenge({
        emailMasked: pending.emailMasked,
        expiresAt: pending.expiresAt,
        resendAvailableAt: pending.resendAvailableAt,
      });
    }
  }, [pending, pendingLoading, restored, college]);

  const finishBack = useCallback(() => {
    setCollege(null);
    setChallenge(null);
    setLeaving(false);
    setSlidesIn(false);
    setVerifyShown(false);
  }, []);

  const goBack = useCallback(() => {
    if (leaving) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!isPhone || reduced) {
      finishBack();
      return;
    }
    setLeaving(true);
  }, [isPhone, leaving, finishBack]);

  // The slide-out ends the screen; the timer is the backstop if the animation
  // event never arrives (a tab in the background).
  useEffect(() => {
    if (!leaving) return undefined;
    const id = window.setTimeout(finishBack, SLIDE_MS + 120);
    return () => window.clearTimeout(id);
  }, [leaving, finishBack]);

  // On a large screen the verify step replaces the list inside the same scroll
  // box: remember where the list was and put it back.
  useLayoutEffect(() => {
    const box = screenRef.current;
    if (!box || isPhone) return;
    if (college) {
      savedScroll.current = box.scrollTop;
      box.scrollTop = 0;
    } else {
      box.scrollTop = savedScroll.current;
    }
  }, [college, isPhone]);

  // The system back button and the browser's back close the verify screen
  // first, the same as the arrow on it.
  useOverlayBack(Boolean(college), goBack);

  // The campus picture runs up under the status bar (light icons over the sky).
  // The verification screen is plain, so the bars go back to the theme's own.
  //
  // It is kept for the whole slide, both ways: dropping it the moment a college
  // is tapped made the page behind shift down by the status bar's height and
  // paint a white strip before the new screen had arrived (and the reverse on
  // the way back). The verify screen covers the page, so the swap is invisible
  // once it is fully in.
  useSystemBars({ status: 'transparent', statusIcons: 'light' }, !college || !verifyShown || leaving);

  // Fully in: after the slide (the event below, or this timer when there is no
  // animation event: reduced motion, a tab in the background), straight away
  // when there is no slide (a restored code, a large screen).
  useEffect(() => {
    if (!college || verifyShown || leaving) return undefined;
    if (!isPhone || !slidesIn) {
      setVerifyShown(true);
      return undefined;
    }
    const id = window.setTimeout(() => setVerifyShown(true), SLIDE_MS + 120);
    return () => window.clearTimeout(id);
  }, [college, verifyShown, leaving, isPhone, slidesIn]);

  if (pendingLoading && !restored) {
    return (
      <div className={styles.screen} aria-busy="true" data-step="loading">
        <div className={styles.screenBody}>
          <div className={styles.skeletonCard} />
        </div>
      </div>
    );
  }

  const verify = college ? (
    <CollegeEmailVerify
      key={college.id}
      college={college}
      initialChallenge={challenge}
      onBack={goBack}
      onVerified={onVerified}
      screen={isPhone}
    />
  ) : null;

  const keepCurrent = onCancel ? (
    <p className={styles.note} style={{ textAlign: 'center' }}>
      <button type="button" className={styles.linkBtn} onClick={onCancel}>
        Keep my current college email
      </button>
    </p>
  ) : null;

  return (
    <div
      ref={screenRef}
      className={styles.screen}
      data-step={college ? 'verify' : 'pick'}
    >
      <div className={college && !isPhone ? styles.pickHidden : styles.pickLayer}>
        <CollegePicker
          onCancel={onCancel}
          onSelect={(c) => {
            setChallenge(null);
            setSlidesIn(true);
            setCollege(c);
          }}
        />
      </div>

      {college && isPhone
        ? createPortal(
            <div
              className={`${styles.verifyScreen} ${slidesIn && !leaving ? styles.slideIn : ''} ${leaving ? styles.slideOut : ''}`}
              role="dialog"
              aria-modal="true"
              aria-label={`Verify your ${college.name} email`}
              onAnimationEnd={(e) => {
                if (e.target !== e.currentTarget) return;
                if (!leaving) setVerifyShown(true);
                if (leaving) finishBack();
              }}
            >
              {verify}
              {keepCurrent}
            </div>,
            document.body,
          )
        : null}

      {college && !isPhone ? (
        <div className={styles.screenBody}>
          {verify}
          {keepCurrent}
        </div>
      ) : null}
    </div>
  );
}
