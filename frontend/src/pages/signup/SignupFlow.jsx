import React from 'react';
import { SignupProvider, useSignup } from './SignupContext';
import { AnimatePresence } from 'framer-motion';
import Background from '../../components/common/Background';
import styles from './SignupFlow.module.css';
import SignupProgressBar from './components/SignupProgressBar';

import Step1Welcome from './components/Step1Welcome';
import Step2Identity from './components/Step2Identity';
import Step3Student from './components/Step3Student';
import Step4Email from './components/Step4Email';
import Step5Password from './components/Step5Password';
import Step6Vibe from './components/Step6Vibe';
import Step7Goals from './components/Step7Goals';
import Step8Discovery from './components/Step8Discovery';
import Step9Personality from './components/Step9Personality';
import Step10Signature from './components/Step10Signature';
import Step11Loading from './components/Step11Loading';

const StepRenderer = () => {
  const { currentStep } = useSignup();

  const renderStep = () => {
    switch (currentStep) {
      case 1: return <Step1Welcome key="step1" />;
      case 2: return <Step2Identity key="step2" />;
      case 3: return <Step3Student key="step3" />;
      case 4: return <Step4Email key="step4" />;
      case 5: return <Step5Password key="step5" />;
      case 6: return <Step6Vibe key="step6" />;
      case 7: return <Step7Goals key="step7" />;
      case 8: return <Step8Discovery key="step8" />;
      case 9: return <Step9Personality key="step9" />;
      case 10: return <Step10Signature key="step10" />;
      case 11: return <Step11Loading key="step11" />;
      default: return <div>Unknown Step</div>;
    }
  };

  return (
    <>
      <Background />
      <div className={styles.flowContainer}>
      <SignupProgressBar />
      <div className={styles.contentArea}>
        <AnimatePresence mode="wait">
          {renderStep()}
        </AnimatePresence>
      </div>
      </div>
    </>
  );
};

export default function SignupFlow() {
  return (
    <SignupProvider>
      <StepRenderer />
    </SignupProvider>
  );
}
