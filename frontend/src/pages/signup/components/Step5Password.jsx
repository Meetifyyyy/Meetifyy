import React, { useState } from 'react';
import { useSignup } from '../SignupContext';
import AnimatedStep from './AnimatedStep';
import { ArrowRight, Lock, CheckCircle2, Circle } from 'lucide-react';
import styles from '../SignupFlow.module.css';

export default function Step5Password() {
  const { signupData, updateData, nextStep } = useSignup();
  const [password, setPassword] = useState(signupData.password || '');

  const requirements = [
    { id: 'length', text: 'At least 8 characters', met: password.length >= 8 },
    { id: 'upper', text: 'One uppercase letter', met: /[A-Z]/.test(password) },
    { id: 'lower', text: 'One lowercase letter', met: /[a-z]/.test(password) },
    { id: 'num', text: 'One number', met: /\d/.test(password) },
    { id: 'special', text: 'One special character', met: /[^A-Za-z0-9]/.test(password) }
  ];

  const allMet = requirements.every(r => r.met);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (allMet) {
      updateData({ password });
      nextStep();
    }
  };

  return (
    <AnimatedStep className={styles.stepWrapper}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem', color: '#6366f1' }}>
        <Lock size={24} />
      </div>
      <h2 className={styles.headline}>Secure Your Account</h2>
      
      <form onSubmit={handleSubmit} style={{ width: '100%' }}>
        <input 
          type="password" 
          autoFocus 
          className={`${styles.largeInput} ${!allMet && password.length > 0 ? styles.inputError : ''}`} 
          placeholder="Create a password" 
          value={password} 
          onChange={(e) => setPassword(e.target.value)} 
        />
        
        <div className={styles.checklist}>
          {requirements.map(req => (
            <div key={req.id} className={`${styles.checklistItem} ${req.met ? styles.met : ''}`}>
              {req.met ? <CheckCircle2 size={16} /> : <Circle size={16} />}
              <span>{req.text}</span>
            </div>
          ))}
        </div>

        <button type="submit" className={styles.continueBtn} disabled={!allMet}>
          Secure Account <ArrowRight className={styles.btnIcon} />
        </button>
      </form>
    </AnimatedStep>
  );
}
