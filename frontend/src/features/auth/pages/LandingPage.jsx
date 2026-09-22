import { useEffect } from 'react';
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

  useEffect(() => {
    const htmlEl = document.documentElement;
    const bodyEl = document.body;
    const rootEl = document.getElementById('root');

    htmlEl.classList.add('landing-scroll-active');
    bodyEl.classList.add('landing-scroll-active');
    if (rootEl) {
      rootEl.classList.add('landing-scroll-active');
    }

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
      htmlEl.classList.remove('landing-scroll-active');
      bodyEl.classList.remove('landing-scroll-active');
      if (rootEl) {
        rootEl.classList.remove('landing-scroll-active');
      }
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
