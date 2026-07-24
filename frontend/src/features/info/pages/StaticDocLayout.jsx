import { useEffect, useLayoutEffect, useRef } from 'react';
import Background from '@shared/components/ui/Background';
import LandingNavbar from '../../auth/landing/components/LandingNavbar';
import LandingFooter from '../../auth/landing/components/LandingFooter';
import '../../auth/landing/landing.css';
import styles from './StaticDocLayout.module.css';

export default function StaticDocLayout({
  badge,
  title,
  subtitle,
  effectiveDate,
  children,
}) {
  const originalTheme = useRef(null);
  const hasCapturedTheme = useRef(false);

  useLayoutEffect(() => {
    const htmlEl = document.documentElement;

    if (!hasCapturedTheme.current) {
      originalTheme.current = htmlEl.getAttribute('data-theme');
      hasCapturedTheme.current = true;
    }

    htmlEl.setAttribute('data-theme', 'light');

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme') {
          if (htmlEl.getAttribute('data-theme') !== 'light') {
            htmlEl.setAttribute('data-theme', 'light');
          }
        }
      }
    });

    observer.observe(htmlEl, {
      attributes: true,
      attributeFilter: ['data-theme']
    });

    return () => {
      observer.disconnect();
      if (originalTheme.current) {
        htmlEl.setAttribute('data-theme', originalTheme.current);
      } else {
        htmlEl.removeAttribute('data-theme');
      }
      hasCapturedTheme.current = false;
      originalTheme.current = null;
    };
  }, []);

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
      <Background />
      <LandingNavbar />
      <main className={styles.mainContent}>
        <div className={styles.hero}>
          <div className={styles.heroGlow} />
          {badge && <div className={styles.badge}>{badge}</div>}
          <h1 className={`${styles.title} landing-font-display`}>{title}</h1>
          {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
          {effectiveDate && (
            <div className={styles.metaRow}>
              <span>Effective Date: <strong className={styles.effectiveBadge}>{effectiveDate}</strong></span>
            </div>
          )}
        </div>

        <div className={styles.bodyContainer}>
          {children}
        </div>
      </main>
      <LandingFooter />
    </div>
  );
}
