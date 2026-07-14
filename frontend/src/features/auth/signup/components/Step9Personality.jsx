import React, { useState } from 'react';
import { useSignup } from '../SignupContext';
import AnimatedStep from './AnimatedStep';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, Lightbulb } from 'lucide-react';
import styles from '../SignupFlow.module.css';

export default function Step9Personality() {
  const { signupData, updateData, nextStep } = useSignup();
  const [subStep, setSubStep] = useState(1);
  
  const [weekendActivity, setWeekendActivity] = useState(signupData.weekendActivity || '');
  const [role, setRole] = useState(signupData.role || '');
  const [socialEnergy, setSocialEnergy] = useState(signupData.socialEnergy || '');
  const [energyLevel, setEnergyLevel] = useState(signupData.energyLevel || 50);

  const advance = (field, value, nextSubStep) => {
    updateData({ [field]: value });
    if (nextSubStep === 'done') {
      nextStep();
    } else {
      setSubStep(nextSubStep);
    }
  };

  return (
    <AnimatedStep className={styles.stepWrapper}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem', color: '#f59e0b' }}>
        <Lightbulb size={24} />
        <span style={{ fontWeight: 600 }}>Help us understand your energy.</span>
      </div>

      <AnimatePresence mode="wait">
        
        {subStep === 1 && (
          <motion.div key="friday" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} style={{ width: '100%' }}>
            <h2 className={styles.headline}>Friday evening means...</h2>
            <div className={styles.optionsGrid} style={{ marginTop: '2rem' }}>
              {['Building Projects', 'Watching Movies', 'Hanging Out', 'Gaming', 'Reading', 'Gym'].map(opt => (
                <div 
                  key={opt} 
                  className={`${styles.optionChip} ${weekendActivity === opt ? styles.selected : ''}`} 
                  onClick={() => setWeekendActivity(opt)}
                >
                  <span className={styles.chipLabel}>{opt}</span>
                </div>
              ))}
            </div>
            <button onClick={() => advance('weekendActivity', weekendActivity, 2)} className={styles.continueBtn} disabled={!weekendActivity}>
              Continue <ArrowRight className={styles.btnIcon} />
            </button>
          </motion.div>
        )}

        {subStep === 2 && (
          <motion.div key="role" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} style={{ width: '100%' }}>
            <h2 className={styles.headline}>Pick one:</h2>
            <div className={styles.optionsGrid} style={{ marginTop: '2rem' }}>
              {['Lead', 'Create', 'Analyze', 'Connect'].map(opt => (
                <div 
                  key={opt} 
                  className={`${styles.optionChip} ${role === opt ? styles.selected : ''}`} 
                  onClick={() => setRole(opt)}
                >
                  <span className={styles.chipLabel}>{opt}</span>
                </div>
              ))}
            </div>
            <button onClick={() => advance('role', role, 3)} className={styles.continueBtn} disabled={!role}>
              Continue <ArrowRight className={styles.btnIcon} />
            </button>
          </motion.div>
        )}

        {subStep === 3 && (
          <motion.div key="social" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} style={{ width: '100%' }}>
            <h2 className={styles.headline}>Which describes you better?</h2>
            <div className={styles.optionsGrid} style={{ marginTop: '2rem' }}>
              {['Introvert', 'Ambivert', 'Extrovert'].map(opt => (
                <div 
                  key={opt} 
                  className={`${styles.optionChip} ${socialEnergy === opt ? styles.selected : ''}`} 
                  onClick={() => setSocialEnergy(opt)}
                >
                  <span className={styles.chipLabel}>{opt}</span>
                </div>
              ))}
            </div>
            <button onClick={() => advance('socialEnergy', socialEnergy, 4)} className={styles.continueBtn} disabled={!socialEnergy}>
              Continue <ArrowRight className={styles.btnIcon} />
            </button>
          </motion.div>
        )}

        {subStep === 4 && (
          <motion.div key="energy" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} style={{ width: '100%', textAlign: 'center' }}>
            <h2 className={styles.headline}>Energy Level</h2>
            <p className={styles.subheadline}>How intense are you generally?</p>
            
            <div style={{ marginTop: '3rem', position: 'relative' }}>
              <input 
                type="range" 
                min="0" 
                max="100" 
                value={energyLevel} 
                onChange={(e) => setEnergyLevel(e.target.value)}
                style={{ width: '100%', cursor: 'pointer', accentColor: '#6366f1' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1rem', fontWeight: 600, color: '#6b7280' }}>
                <span>Chill</span>
                <span>Balanced</span>
                <span>Hyper</span>
              </div>
            </div>

            <button onClick={() => advance('energyLevel', energyLevel, 'done')} className={styles.continueBtn}>
              Continue <ArrowRight className={styles.btnIcon} />
            </button>
          </motion.div>
        )}

      </AnimatePresence>
    </AnimatedStep>
  );
}
