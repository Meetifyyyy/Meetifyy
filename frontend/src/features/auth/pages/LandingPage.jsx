import { useEffect } from 'react';
import LandingNavbar from '../landing/components/LandingNavbar';
import EditorialLanding from '../landing/components/EditorialLanding';
import SignupJourneyCTA from '../landing/components/SignupJourneyCTA';
import LandingFooter from '../landing/components/LandingFooter';
import '../landing/landing.css';

export default function LandingPage() {

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
