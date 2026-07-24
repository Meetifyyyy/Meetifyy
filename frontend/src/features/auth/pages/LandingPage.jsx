import { useEffect, useLayoutEffect, useRef } from 'react';
import Background from '@shared/components/ui/Background';
import LandingNavbar from '../landing/components/LandingNavbar';
import LandingHero from '../landing/components/LandingHero';
import HowItWorksSteps from '../landing/components/HowItWorksSteps';
import CampusFeaturesGrid from '../landing/components/CampusFeaturesGrid';
import ProposedCirclesMarquee from '../landing/components/ProposedCirclesMarquee';
import StudentTestimonials from '../landing/components/StudentTestimonials';
import SignupJourneyCTA from '../landing/components/SignupJourneyCTA';
import LandingFooter from '../landing/components/LandingFooter';
import '../landing/landing.css';

export default function LandingPage() {
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
    <>
      <Background />
      <div>
        <LandingNavbar />
        <main>
          <LandingHero />
          <HowItWorksSteps />
          <CampusFeaturesGrid />
          <ProposedCirclesMarquee />
          <StudentTestimonials />
          <SignupJourneyCTA />
        </main>
        <LandingFooter />
      </div>
    </>
  );
}
