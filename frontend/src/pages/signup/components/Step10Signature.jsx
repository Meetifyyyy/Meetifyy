import React, { useState } from 'react';
import { useSignup } from '../SignupContext';
import AnimatedStep from './AnimatedStep';
import { ArrowRight } from 'lucide-react';
import styles from '../SignupFlow.module.css';

export default function Step10Signature() {
  const { signupData, updateData, nextStep } = useSignup();
  const [signature, setSignature] = useState(signupData.signature || '');

  const handleSubmit = (e) => {
    e.preventDefault();
    updateData({ signature });
    nextStep();
  };

  return (
    <AnimatedStep className={styles.stepWrapper}>
      <h2 className={styles.headline}>What makes you unforgettable?</h2>
      <p className={styles.subheadline}>(Optional) Leave a mark on your profile.</p>
      
      <form onSubmit={handleSubmit} style={{ width: '100%' }}>
        <textarea 
          autoFocus 
          className={styles.largeInput} 
          style={{ minHeight: '150px', fontSize: '1.5rem', resize: 'none' }}
          placeholder="Tell future friends something they'll remember." 
          value={signature} 
          onChange={(e) => setSignature(e.target.value)} 
        />
        
        <button type="submit" className={styles.continueBtn}>
          {signature.trim() ? 'Save & Finish' : 'Skip for now'} <ArrowRight className={styles.btnIcon} />
        </button>
      </form>
    </AnimatedStep>
  );
}
