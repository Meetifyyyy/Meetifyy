import React from 'react';
import { useSignup } from '../../context/SignupContext';
import { ArrowLeft } from 'lucide-react';
import styles from '../SignupFlow.module.css';
import { useNavigate } from 'react-router-dom';

export default function SignupProgressBar() {
  const { currentStep, prevStep, totalSteps } = useSignup();
  const navigate = useNavigate();

  const progressPercentage = (currentStep / totalSteps) * 100;

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
        <button onClick={handleBack} className={styles.backButton}>
          <span className={styles.iconCircle}>
            <ArrowLeft size={20} />
          </span>
          <span className={styles.backText}>Back</span>
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
