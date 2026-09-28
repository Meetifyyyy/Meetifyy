import { useRef } from 'react';
import { IS_MOBILE_BUILD } from '@config';
import { ArrowLeft } from '@shared/components/icons';
import { useCollapsingHeader } from '@shared/hooks/useCollapsingHeader';
import styles from './CollapsingHeader.module.css';

/**
 * The app's header for pages that open on a cover image (Profile, Community).
 *
 * Installed app only. Community pages transition to a themed surface; Profile
 * passes its one cover element as the bar's background. `IS_MOBILE_BUILD` is
 * a build-time literal, so the website keeps each page's own header.
 *
 * `coverRef` is the cover element: its height is the scroll distance over
 * which the header fills in.
 *
 * With `coverBackground`, `coverContent` is a copy of the page's cover that
 * becomes the header's background. It is clipped to the header band, so the
 * page's own cover (and the avatar over it) is never painted over; inside the
 * band the copy lines up with the page's cover exactly, scrolls away with it,
 * pins, and crossfades into `coverBackdrop` (the same cover, blurred once by
 * CSS). A pull zooms it from the top edge and widens the band to the pulled
 * distance, so the area the pull opens is always filled; the header's buttons
 * travel down with the page (see useCollapsingHeader and PullToRefresh).
 */
export default function CollapsingHeader({
  coverRef,
  title,
  subtitle,
  onBack,
  backVariant = 'default',
  coverShade = true,
  coverBackground = false,
  coverContent,
  coverBackdrop,
  collapseRangeMultiplier = 1,
  headerRef: providedHeaderRef,
  rightAction,
}) {
  const internalHeaderRef = useRef(null);
  const headerRef = providedHeaderRef || internalHeaderRef;
  useCollapsingHeader({
    enabled: IS_MOBILE_BUILD,
    headerRef,
    coverRef,
    coverBackground,
    collapseRangeMultiplier,
  });

  if (!IS_MOBILE_BUILD) return null;

  return (
    <div
      ref={headerRef}
      className={`${styles.header} ${coverShade ? '' : styles.noCoverShade} ${backVariant === 'profile' ? styles.profileHeader : ''} ${coverBackground ? styles.withCover : ''}`}
    >
      {coverBackground && (
        <div className={styles.coverClip} aria-hidden="true">
          <div className={styles.coverBackground}>
            <div className={styles.coverStretch}>
              <div className={styles.coverSharp}>{coverContent}</div>
              {coverBackdrop && (
                <>
                  <div className={`${styles.coverBlur} ${styles.coverBlurScroll}`}>{coverBackdrop}</div>
                  <div className={`${styles.coverBlur} ${styles.coverBlurPull}`}>{coverBackdrop}</div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {!coverBackground && <div className={styles.surface} aria-hidden="true" />}
      <button
        type="button"
        className={`${styles.back} ${backVariant === 'profile' ? styles.backProfile : ''}`}
        onClick={onBack}
        aria-label="Go back"
      >
        {/* Two glyphs cross-fade so the icon reads on the cover and on the theme. */}
        <ArrowLeft size={20} className={styles.iconOnCover} />
        <ArrowLeft size={20} className={styles.iconOnSurface} />
      </button>
      <div className={styles.titles}>
        <div className={styles.titleStack}>
          <span className={styles.title}>{title}</span>
          {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
        </div>
      </div>
      {rightAction}
    </div>
  );
}
