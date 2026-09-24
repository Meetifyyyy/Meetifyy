import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import { SignupProvider, useSignup } from '../context/SignupContext';
import { AuthShell, StepProgress, styles as s } from '../shared/ui';

import Step1Intro from './components/Step1Intro';
import Step2Profile from './components/Step2Profile';
import Step3College from './components/Step3College';
import Step4Password from './components/Step4Password';
import Step5Verify from './components/Step5Verify';
import Step6Photo from './components/Step6Photo';
import SignupFinishing from './components/SignupFinishing';

const STEPS = [Step1Intro, Step2Profile, Step3College, Step4Password, Step5Verify, Step6Photo];
const OUT_MS = 180;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Which screen is on show, lagging the real one by a short fade-out.
 *
 * The step (or the finishing screen) changes in context immediately; what is
 * rendered follows OUT_MS later, after the old content has faded. That is what
 * makes the swap a transition rather than a replacement: the old form leaves,
 * the card resizes while nothing is visible, and the new form cascades in.
 */
/** Position of a screen in the flow, so a change can be called forward or back. */
const orderOf = (screen) => (screen === 'finish' ? Number.MAX_SAFE_INTEGER : screen);

function useDisplayed(target) {
  const [shown, setShown] = useState(target);
  const [phase, setPhase] = useState('in');
  // Forward (next step) or back, decided when the change starts, so the old
  // screen leaves and the new one arrives on the same side.
  const [dir, setDir] = useState('fwd');

  useEffect(() => {
    if (target === shown) return undefined;
    setDir(orderOf(target) >= orderOf(shown) ? 'fwd' : 'back');
    if (prefersReducedMotion()) {
      setShown(target);
      return undefined;
    }
    setPhase('out');
    const t = setTimeout(() => {
      setShown(target);
      setPhase('in');
    }, OUT_MS);
    return () => clearTimeout(t);
  }, [target, shown]);

  return [shown, phase, dir];
}

const StepRenderer = () => {
  const { currentStep, totalSteps, finishing, prevStep } = useSignup();
  const goBack = useSmartBack();

  /*
   * Back: the previous step while there is one to return to, otherwise the
   * previous page. Step 6 runs after the code is verified and the person is
   * signed in, so steps 1-5 are spent by then (SignupContext would bounce
   * them forward again); from there, and from the finishing screen, back
   * leaves signup instead.
   */
  const handleBack = useCallback(() => {
    if (!finishing && currentStep > 1 && currentStep < totalSteps) prevStep();
    else goBack('/');
  }, [finishing, currentStep, totalSteps, prevStep, goBack]);
  const target = finishing ? 'finish' : currentStep;
  const [shown, phase, dir] = useDisplayed(target);
  const Step = typeof shown === 'number' ? STEPS[shown - 1] : null;

  return (
    // The finishing screen stands alone: no rail, content centred in a card
    // held at the size it had on step 1. Driven by what is SHOWN, not by the
    // target: the rail stays (fading) while the last step fades out, and only
    // leaves at the swap, so the old step never snaps to full width mid-fade.
    <AuthShell
      showStory={false}
      railStep={shown === 'finish' ? null : currentStep}
      holdSize={shown === 'finish'}
      railLeaving={target === 'finish' && shown !== 'finish'}
      // No back on the finishing screen: the account is done.
      onBack={finishing ? false : handleBack}
      progressCurrent={finishing ? null : currentStep}
      progressTotal={totalSteps}
    >
      {!finishing ? <StepProgress currentStep={currentStep} totalSteps={totalSteps} /> : null}
      <div
        key={shown}
        className={`${s.content} ${phase === 'out' ? s.stepOut : s.stepIn}`}
        data-slide={dir}
      >
        {shown === 'finish' && finishing ? (
          <SignupFinishing avatar={finishing.avatar} />
        ) : Step ? (
          <Step />
        ) : null}
      </div>
      {/* Until the account exists (the password step creates it), someone who
          already has one can still switch to logging in. */}
      {!finishing && currentStep <= 4 ? (
        <div className={s.footer}>
          Already have an account?
          <Link to="/login" className={s.link}>
            Log in
          </Link>
        </div>
      ) : null}
    </AuthShell>
  );
};

export default function SignupFlow() {
  return (
    <SignupProvider>
      <StepRenderer />
    </SignupProvider>
  );
}
