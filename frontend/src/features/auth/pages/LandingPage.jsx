import { useEffect } from 'react';
import LandingNavbar from '../landing/components/LandingNavbar';
import EditorialLanding from '../landing/components/EditorialLanding';
import SignupJourneyCTA from '../landing/components/SignupJourneyCTA';
import LandingFooter from '../landing/components/LandingFooter';
import '../landing/landing.css';
import { warmAuthScreens } from '../routes/authRoutes';

const AUTH_LINK = 'a[href="/login"], a[href="/signup"]';

export default function LandingPage() {
  // Log in / Create account used to fetch their screens only once tapped, so
  // the first tap sat on a blank Suspense fallback for a network round-trip.
  // Warm them once the landing page is idle, and at once on the first sign of
  // intent (hover, touch or keyboard focus on any auth link).
  useEffect(() => {
    let idle = null;
    let timer = null;
    if ('requestIdleCallback' in window) {
      idle = window.requestIdleCallback(() => warmAuthScreens(), { timeout: 2500 });
    } else {
      timer = setTimeout(warmAuthScreens, 1500);
    }
    const onIntent = (e) => {
      if (e.target instanceof Element && e.target.closest(AUTH_LINK)) warmAuthScreens();
    };
    document.addEventListener('pointerover', onIntent, { passive: true });
    document.addEventListener('touchstart', onIntent, { passive: true });
    document.addEventListener('focusin', onIntent);
    return () => {
      if (idle !== null) window.cancelIdleCallback(idle);
      clearTimeout(timer);
      document.removeEventListener('pointerover', onIntent);
      document.removeEventListener('touchstart', onIntent);
      document.removeEventListener('focusin', onIntent);
    };
  }, []);


  useEffect(() => {
    const htmlEl = document.documentElement;
    const bodyEl = document.body;
    const rootEl = document.getElementById('root');

    htmlEl.classList.add('landing-scroll-active');
    bodyEl.classList.add('landing-scroll-active');
    if (rootEl) {
      rootEl.classList.add('landing-scroll-active');
    }

    htmlEl.style.overflow = 'auto';
    bodyEl.style.height = 'auto';
    bodyEl.style.overflow = 'visible';
    if (rootEl) {
      rootEl.style.height = 'auto';
      rootEl.style.overflow = 'visible';
    }

    return () => {
      htmlEl.classList.remove('landing-scroll-active');
      bodyEl.classList.remove('landing-scroll-active');
      if (rootEl) {
        rootEl.classList.remove('landing-scroll-active');
      }
      // Cleared, not restored: nothing else sets these inline outside a
      // scroll lock, and a "previous" captured while another page's override
      // was still applied would write that override back and leave the app
      // unscrollable until a reload.
      htmlEl.style.removeProperty('overflow');
      bodyEl.style.removeProperty('height');
      bodyEl.style.removeProperty('overflow');
      if (rootEl) {
        rootEl.style.removeProperty('height');
        rootEl.style.removeProperty('overflow');
      }
    };
  }, []);
  return (
    <div style={{ background: 'var(--color-bg-white)', minHeight: '100vh' }}>
      <LandingNavbar />
      <main>
        <EditorialLanding />
        <SignupJourneyCTA />
      </main>
      <LandingFooter />
    </div>
  );
}
