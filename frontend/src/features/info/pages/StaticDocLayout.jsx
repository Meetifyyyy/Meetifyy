import { useLayoutEffect } from 'react';
import LandingNavbar from '../../auth/landing/components/LandingNavbar';
import LandingFooter from '../../auth/landing/components/LandingFooter';
import '../../auth/landing/landing.css';
import styles from './StaticDocLayout.module.css';

export default function StaticDocLayout({
  badge,
  title,
  subtitle,
  effectiveDate,
  // Shown for the four admin-managed legal documents, which are served from the
  // database. Absent on the pages that are still hand-written (About).
  effectiveFrom,
  noHeroCard = false,
  leftAlign = false,
  children,
}) {
  /*
   * These pages used to pin `data-theme` to light with a MutationObserver,
   * the same way the landing page still does, so they rendered white in a dark
   * app. They have a designed dark palette now — see
   * StaticDocLayout.module.css — so the pin is gone and they follow the theme
   * like every other screen.
   *
   * The landing page keeps its pin deliberately. It is a marketing surface
   * with its own art direction and no dark treatment, and it is explicitly out
   * of scope.
   */

  /*
   * A LAYOUT effect, not a passive one.
   *
   * These lines hand the document's scrolling from the app shell (which pins
   * html/body/#root to the viewport and scrolls inside) to the page itself,
   * and hand it back on the way out. As a `useEffect` that swap ran AFTER the
   * browser had already painted, so every entry and every exit showed one frame
   * of the new page inside the old scroll container — the flicker when leaving a
   * legal page for Sign In and the one when pressing back onto it again.
   *
   * `useLayoutEffect` runs after the DOM is updated and before paint, so the
   * container is already correct in the first frame anyone sees. The work is a
   * handful of style writes on three elements, which is well within the budget
   * for blocking a frame.
   */
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });

    const htmlEl = document.documentElement;
    const bodyEl = document.body;
    const rootEl = document.getElementById('root');

    const prevHtmlOverflow = htmlEl.style.overflow;
    const prevBodyHeight = bodyEl.style.height;
    const prevBodyOverflow = bodyEl.style.overflow;

    let prevRootHeight = '';
    let prevRootOverflow = '';
    if (rootEl) {
      prevRootHeight = rootEl.style.height;
      prevRootOverflow = rootEl.style.overflow;
    }

    htmlEl.style.overflow = 'auto';
    bodyEl.style.height = 'auto';
    bodyEl.style.overflow = 'visible';
    if (rootEl) {
      rootEl.style.height = 'auto';
      rootEl.style.overflow = 'visible';
    }

    return () => {
      htmlEl.style.overflow = prevHtmlOverflow;
      bodyEl.style.height = prevBodyHeight;
      bodyEl.style.overflow = prevBodyOverflow;
      if (rootEl) {
        rootEl.style.height = prevRootHeight;
        rootEl.style.overflow = prevRootOverflow;
      }
    };
  }, []);

  return (
    <div className={styles.pageWrapper}>
      <LandingNavbar />
      <main className={styles.mainContent}>
        {noHeroCard ? (
          <div className={leftAlign ? styles.heroNoCardLeft : styles.heroNoCard}>
            {badge && <div className={styles.badge}>{badge}</div>}
            <h1 className={`${leftAlign ? styles.titleNoCardLeft : styles.titleNoCard} landing-font-display`}>{title}</h1>
            {subtitle && <p className={leftAlign ? styles.subtitleLeft : styles.subtitle}>{subtitle}</p>}
            {(effectiveDate || effectiveFrom) && (
              <div className={leftAlign ? styles.metaRowLeft : styles.metaRow}>
                {effectiveDate && (
                  <span>Last Updated: <strong className={styles.effectiveBadge}>{effectiveDate}</strong></span>
                )}
                {effectiveFrom && <span>Effective: <strong className={styles.effectiveBadge}>{effectiveFrom}</strong></span>}
              </div>
            )}
          </div>
        ) : (
          <div className={styles.hero}>
            <div className={styles.heroGlow} />
            {badge && <div className={styles.badge}>{badge}</div>}
            <h1 className={`${styles.title} landing-font-display`}>{title}</h1>
            {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
            {(effectiveDate || effectiveFrom) && (
              <div className={styles.metaRow}>
                {effectiveDate && (
                  <span>Last Updated: <strong className={styles.effectiveBadge}>{effectiveDate}</strong></span>
                )}
                {effectiveFrom && <span>Effective: <strong className={styles.effectiveBadge}>{effectiveFrom}</strong></span>}
              </div>
            )}
          </div>
        )}

        <div className={styles.bodyContainer}>
          {children}
        </div>
      </main>
      <LandingFooter />
    </div>
  );
}
