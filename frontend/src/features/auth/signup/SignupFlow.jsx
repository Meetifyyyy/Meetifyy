import React from 'react';
import { SignupProvider, useSignup } from './SignupContext';
import { AnimatePresence } from 'framer-motion';
import styles from './SignupFlow.module.css';
import SignupProgressBar from './components/SignupProgressBar';
import loginIllustration from '@assets/login-illustration.png';

import Step1Identity from './components/Step1Identity';
import Step2Academic from './components/Step2Academic';
import Step3OTP from './components/Step3OTP';
import Step4Password from './components/Step4Password';
import Step5Avatar from './components/Step5Avatar';

const StepRenderer = () => {
  const { currentStep } = useSignup();

  const renderStep = () => {
    switch (currentStep) {
      case 1: return <Step1Identity key="step1" />;
      case 2: return <Step2Academic key="step2" />;
      case 3: return <Step3OTP key="step3" />;
      case 4: return <Step4Password key="step4" />;
      case 5: return <Step5Avatar key="step5" />;
      default: return <div>Unknown Step</div>;
    }
  };

  return (
    <div className={styles.pageContainer}>
      <div className={styles.signupBox}>
        {/* Left Panel: UI Design Showcase */}
        <div className={styles.leftPanel}>
          <div className={styles.illustrationWrapper}>
            <img src={loginIllustration} alt="Signup Illustration" className={styles.loginIllustration} />
          </div>
        </div>

        {/* Right Panel: Signup Form */}
        <div className={styles.rightPanel}>
          <SignupProgressBar />
          <div className={styles.contentArea}>
            <AnimatePresence mode="wait">
              {renderStep()}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
};

export default function SignupFlow() {
  return (
    <SignupProvider>
      <StepRenderer />
    </SignupProvider>
  );
}
