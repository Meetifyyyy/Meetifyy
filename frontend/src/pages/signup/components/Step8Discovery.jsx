import React, { useState } from 'react';
import { useSignup } from '../SignupContext';
import AnimatedStep from './AnimatedStep';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, User, Users, Globe, Layers } from 'lucide-react';
import styles from '../SignupFlow.module.css';

export default function Step8Discovery() {
  const { signupData, updateData, nextStep } = useSignup();
  const [subStep, setSubStep] = useState(1);
  
  const [discoveryPreference, setDiscoveryPreference] = useState(signupData.discoveryPreference || '');
  const [crossCollege, setCrossCollege] = useState(signupData.crossCollege || '');
  const [distance, setDistance] = useState(signupData.distance || '');

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
      <AnimatePresence mode="wait">
        
        {subStep === 1 && (
          <motion.div key="pref" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} style={{ width: '100%' }}>
            <h2 className={styles.headline}>Who should Meetifyy introduce you to?</h2>
            <p className={styles.subheadline}>How do you prefer meeting people?</p>
            <div className={styles.optionsGrid}>
              {[
                { id: 'One-on-One', icon: <User size={28} /> },
                { id: 'Small Groups', icon: <Users size={28} /> },
                { id: 'Large Communities', icon: <Globe size={28} /> },
                { id: 'Any', icon: <Layers size={28} /> }
              ].map(opt => (
                <div 
                  key={opt.id} 
                  className={`${styles.optionChip} ${discoveryPreference === opt.id ? styles.selected : ''}`} 
                  onClick={() => setDiscoveryPreference(opt.id)}
                >
                  <span className={styles.chipIcon}>{opt.icon}</span>
                  <span className={styles.chipLabel}>{opt.id}</span>
                </div>
              ))}
            </div>
            <button onClick={() => advance('discoveryPreference', discoveryPreference, 2)} className={styles.continueBtn} disabled={!discoveryPreference}>
              Continue <ArrowRight className={styles.btnIcon} />
            </button>
          </motion.div>
        )}

        {subStep === 2 && (
          <motion.div key="cross" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} style={{ width: '100%' }}>
            <h2 className={styles.headline}>Are you open to connecting with students from other colleges?</h2>
            <div className={styles.optionsGrid} style={{ marginTop: '2rem' }}>
              {['Yes', 'No', 'Depends'].map(opt => (
                <div 
                  key={opt} 
                  className={`${styles.optionChip} ${crossCollege === opt ? styles.selected : ''}`} 
                  onClick={() => setCrossCollege(opt)}
                >
                  <span className={styles.chipLabel}>{opt}</span>
                </div>
              ))}
            </div>
            <button onClick={() => advance('crossCollege', crossCollege, 3)} className={styles.continueBtn} disabled={!crossCollege}>
              Continue <ArrowRight className={styles.btnIcon} />
            </button>
          </motion.div>
        )}

        {subStep === 3 && (
          <motion.div key="distance" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} style={{ width: '100%' }}>
            <h2 className={styles.headline}>How far should Meetifyy search?</h2>
            <div className={styles.optionsGrid} style={{ marginTop: '2rem' }}>
              {['My College Only', 'My University', 'My City', 'Entire India'].map(opt => (
                <div 
                  key={opt} 
                  className={`${styles.optionChip} ${distance === opt ? styles.selected : ''}`} 
                  onClick={() => setDistance(opt)}
                >
                  <span className={styles.chipLabel}>{opt}</span>
                </div>
              ))}
            </div>
            <button onClick={() => advance('distance', distance, 'done')} className={styles.continueBtn} disabled={!distance}>
              Continue <ArrowRight className={styles.btnIcon} />
            </button>
          </motion.div>
        )}

      </AnimatePresence>
    </AnimatedStep>
  );
}
