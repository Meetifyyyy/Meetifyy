import { useEffect } from 'react';
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

  useEffect(() => {
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
