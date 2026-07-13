import React, { useState } from 'react';
import { useSignup } from '../SignupContext';
import AnimatedStep from './AnimatedStep';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import styles from '../SignupFlow.module.css';

const vibeOptions = [
  { id: 'Entrepreneur', icon: '🚀' },
  { id: 'Creator', icon: '🎨' },
  { id: 'Coder', icon: '💻' },
  { id: 'Designer', icon: '✨' },
  { id: 'Public Speaker', icon: '🎤' },
  { id: 'Musician', icon: '🎵' },
  { id: 'Athlete', icon: '🏆' },
  { id: 'Gamer', icon: '🎮' },
  { id: 'Writer', icon: '✍️' },
  { id: 'Photographer', icon: '📸' },
  { id: 'Researcher', icon: '🔬' },
  { id: 'Content Creator', icon: '📱' },
];

const seekingOptions = [
  { id: 'Make New Friends', icon: '🤝' },
  { id: 'Startup Co-founders', icon: '🚀' },
  { id: 'Study Groups', icon: '📚' },
  { id: 'Event Buddies', icon: '🎤' },
  { id: 'Internships', icon: '💼' },
  { id: 'Networking', icon: '🎯' },
  { id: 'Mentorship', icon: '🧠' },
  { id: 'Club Communities', icon: '🏛' },
  { id: 'Skill Exchange', icon: '🔄' },
];

const interestOptions = [
  'AI', 'Startups', 'Finance', 'Movies', 'Cricket', 'Anime', 
  'Music', 'Fitness', 'Psychology', 'Books', 'Travel', 'Technology'
];

export default function Step6Vibe() {
  const { signupData, updateData, nextStep } = useSignup();
  const [subStep, setSubStep] = useState(1);
  
  const [vibe, setVibe] = useState(signupData.vibe || []);
  const [seeking, setSeeking] = useState(signupData.seeking || []);
  const [interests, setInterests] = useState(signupData.interests || []);

  const toggleArray = (arr, setArr, item) => {
    if (arr.includes(item)) {
      setArr(arr.filter(i => i !== item));
    } else {
      setArr([...arr, item]);
    }
  };

  const handleNextSubStep = (step) => {
    if (step === 2) updateData({ vibe });
    if (step === 3) updateData({ seeking });
    if (step === 'done') {
      updateData({ interests });
      nextStep();
    } else {
      setSubStep(step);
    }
  };

  return (
    <AnimatedStep className={styles.stepWrapper}>
      <AnimatePresence mode="wait">
        
        {subStep === 1 && (
          <motion.div key="vibe" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} style={{ width: '100%' }}>
            <h2 className={styles.headline}>What best describes you?</h2>
            <div className={styles.optionsGrid} style={{ marginTop: '2rem' }}>
              {vibeOptions.map(opt => {
                const isSelected = vibe.includes(opt.id);
                return (
                  <div 
                    key={opt.id} 
                    className={`${styles.optionChip} ${isSelected ? styles.selected : ''}`} 
                    onClick={() => toggleArray(vibe, setVibe, opt.id)}
                  >
                    <span className={styles.chipIcon}>{opt.icon}</span>
                    <span className={styles.chipLabel}>{opt.id}</span>
                  </div>
                );
              })}
            </div>
            {vibe.length > 0 ? (
              <div className={styles.successText} style={{ marginTop: '1rem' }}>
                Looks like you're a {vibe.join(' + ')}.
              </div>
            ) : (
              <div className={styles.errorText} style={{ marginTop: '1rem', color: '#6b7280' }}>
                Select at least 1 vibe to continue.
              </div>
            )}
            <button onClick={() => handleNextSubStep(2)} className={styles.continueBtn} disabled={vibe.length === 0}>
              Continue <ArrowRight className={styles.btnIcon} />
            </button>
          </motion.div>
        )}

        {subStep === 2 && (
          <motion.div key="seeking" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} style={{ width: '100%' }}>
            <h2 className={styles.headline}>What are you hoping to find?</h2>
            <div className={styles.optionsGrid} style={{ marginTop: '2rem' }}>
              {seekingOptions.map(opt => {
                const isSelected = seeking.includes(opt.id);
                return (
                  <div 
                    key={opt.id} 
                    className={`${styles.optionChip} ${isSelected ? styles.selected : ''}`} 
                    onClick={() => toggleArray(seeking, setSeeking, opt.id)}
                  >
                    <span className={styles.chipIcon}>{opt.icon}</span>
                    <span className={styles.chipLabel}>{opt.id}</span>
                  </div>
                );
              })}
            </div>
            
            <div style={{ marginTop: '1rem', color: seeking.length > 0 ? '#10b981' : '#6b7280', fontWeight: 500, fontSize: '0.875rem' }}>
              {seeking.length > 0 ? 'Great choices!' : 'Select at least 1 goal to continue.'}
            </div>

            <button onClick={() => handleNextSubStep(3)} className={styles.continueBtn} disabled={seeking.length === 0}>
              Continue <ArrowRight className={styles.btnIcon} />
            </button>
          </motion.div>
        )}

        {subStep === 3 && (
          <motion.div key="interests" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} style={{ width: '100%', textAlign: 'center' }}>
            <h2 className={styles.headline}>What can you talk about for hours?</h2>
            <div className={styles.bubbleContainer} style={{ marginTop: '2rem' }}>
              {interestOptions.map(opt => {
                const isSelected = interests.includes(opt);
                return (
                  <motion.div 
                    key={opt}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className={`${styles.bubble} ${isSelected ? styles.selected : ''}`}
                    onClick={() => toggleArray(interests, setInterests, opt)}
                  >
                    {opt}
                  </motion.div>
                );
              })}
            </div>
            
            <div style={{ marginTop: '1.5rem', fontWeight: 500, fontSize: '0.875rem', color: interests.length >= 3 ? '#10b981' : '#f59e0b' }}>
              {interests.length >= 3 ? 'Awesome! That\'s plenty.' : interests.length > 0 ? `Choose ${3 - interests.length} more interest${3 - interests.length > 1 ? 's' : ''}` : 'Select at least 3 interests to continue.'}
            </div>

            <button onClick={() => handleNextSubStep('done')} className={styles.continueBtn} disabled={interests.length < 3}>
              Continue <ArrowRight className={styles.btnIcon} />
            </button>
          </motion.div>
        )}

      </AnimatePresence>
    </AnimatedStep>
  );
}
