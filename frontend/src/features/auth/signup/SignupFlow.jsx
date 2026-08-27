import React from 'react';
import { useNavigate } from 'react-router-dom';
import { SignupProvider, useSignup } from '../context/SignupContext';
import { AuthShell, StepProgress, styles as s } from '../shared/ui';

import Step1Identity from './components/Step1Identity';
import Step2Academic from './components/Step2Academic';
import Step3Password from './components/Step3Password';
import Step4OTP from './components/Step4OTP';
import Step5Avatar from './components/Step5Avatar';

const StepRenderer = () => {
  const { currentStep, totalSteps, prevStep } = useSignup();
  const navigate = useNavigate();

  const handleBack = () => {
    if (currentStep === 1) navigate('/login');
    else prevStep();
  };

  const renderStep = () => {
    switch (currentStep) {
      case 1: return <Step1Identity key="step1" />;
      case 2: return <Step2Academic key="step2" />;
      case 3: return <Step3Password key="step3" />;
      case 4: return <Step4OTP key="step4" />;
      case 5: return <Step5Avatar key="step5" />;
      default: return null;
    }
  };

  return (
    <AuthShell
      headline={'Join a campus\nthat gets you.'}
      subtext="A few quick steps and you're in, verified, matched, and ready to connect."
    >
      <StepProgress
        currentStep={currentStep}
        totalSteps={totalSteps}
        onBack={handleBack}
        // The final step is post-OTP (authenticated) — there's no valid step to
        // return to, so the back control is hidden there.
        hideBack={currentStep >= totalSteps}
      />
      <div className={s.content}>{renderStep()}</div>
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
