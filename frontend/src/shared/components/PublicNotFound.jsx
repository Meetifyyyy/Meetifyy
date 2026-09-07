/**
 * Not Found for visitors without a session.
 *
 * Signed-out visitors who hit an unknown url used to be sent to '/' by
 * ProtectedRoute. That was wrong twice over. For a person, a dead link silently
 * dropped them on the landing page with no indication that the thing they
 * clicked no longer exists. For a crawler, every dead url answered 200 and
 * rendered the homepage, so a retired link became another duplicate of '/'
 * rather than a page that could be dropped from the index.
 *
 * Wrapped in the landing chrome rather than the dashboard shell, because the
 * dashboard shell assumes a session: header, sidebar and bottom nav are all
 * built from `currentUser`. This keeps a signed-out 404 looking like part of
 * the public site, with the navigation needed to get somewhere useful.
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import LandingNavbar from '@features/auth/landing/components/LandingNavbar';
import LandingFooter from '@features/auth/landing/components/LandingFooter';
import '@features/auth/landing/landing.css';
import NotFoundState from './ui/NotFoundState';
import styles from './PublicNotFound.module.css';

export default function PublicNotFound() {
  const navigate = useNavigate();
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
      attributeFilter: ['data-theme'],
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
      <LandingNavbar />
      <main className={styles.mainContent}>
        <NotFoundState
          type="page"
          coverPage={false}
          // "Back to Home Feed" is the default and it is meaningless here:
          // there is no feed without an account, and the link would bounce
          // straight back through ProtectedRoute.
          actionLabel="Back to home"
          onAction={() => navigate('/', { replace: true })}
        />
      </main>
      <LandingFooter />
    </div>
  );
}
