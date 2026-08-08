import React from 'react';
import { useSignup } from '../../context/SignupContext';
import { ArrowLeft } from 'lucide-react';
import styles from '../SignupFlow.module.css';
import { useNavigate } from 'react-router-dom';

export default function SignupProgressBar() {
  const { currentStep, prevStep, totalSteps } = useSignup();
  const navigate = useNavigate();

  const progressPercentage = (currentStep / totalSteps) * 100;

  // The final step (avatar) is post-OTP: the user is already authenticated, so
  // there's no valid earlier step to return to. Hide back there (kept in the DOM
  // with visibility:hidden so the progress track stays aligned).
  const backHidden = currentStep >= totalSteps;

  const handleBack = () => {
    if (currentStep === 1) {
      navigate('/');
    } else {
      prevStep();
    }
  };

  return (
    <>
      <div className={styles.progressContainer}>
        <button
          onClick={handleBack}
          className={styles.backButton}
          aria-label="Go back"
          disabled={backHidden}
          style={{ visibility: backHidden ? 'hidden' : 'visible' }}
        >
          <ArrowLeft size={22} />
        </button>
        <div className={styles.progressTrack}>
          <div
            className={styles.progressFill}
            style={{ width: `${progressPercentage}%` }}
          />
        </div>
      </div>
    </>
  );
}
