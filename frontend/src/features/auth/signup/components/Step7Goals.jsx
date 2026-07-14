import React, { useState } from 'react';
import { useSignup } from '../SignupContext';
import AnimatedStep from './AnimatedStep';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import styles from '../SignupFlow.module.css';

const goalOptions = [
  'Build a Startup',
  'Crack Placements',
  'Improve Communication',
  'Build My Network',
  'Learn New Skills',
  'Find Like-Minded People',
  'Win Competitions',
  'Get Internships',
];

export default function Step7Goals() {
  const { signupData, updateData, nextStep } = useSignup();
  const [subStep, setSubStep] = useState(1);
  
  const [goals, setGoals] = useState(signupData.goals || []);
  const [dreamCollab, setDreamCollab] = useState(signupData.dreamCollab || '');

  const toggleGoal = (goal) => {
    if (goals.includes(goal)) {
      setGoals(goals.filter(g => g !== goal));
    } else {
      setGoals([...goals, goal]);
    }
  };

  const handleNextSubStep = (step) => {
    if (step === 2) updateData({ goals });
    if (step === 'done') {
      updateData({ dreamCollab });
      nextStep();
    } else {
      setSubStep(step);
    }
  };

  return (
    <AnimatedStep className={styles.stepWrapper}>
      <AnimatePresence mode="wait">
        
        {subStep === 1 && (
          <motion.div key="goals" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} style={{ width: '100%' }}>
            <h2 className={styles.headline}>What are you working toward this year?</h2>
            <div className={styles.optionsGrid} style={{ marginTop: '2rem' }}>
              {goalOptions.map(opt => {
                const isSelected = goals.includes(opt);
                return (
                  <div 
                    key={opt} 
                    className={`${styles.optionChip} ${isSelected ? styles.selected : ''}`} 
                    onClick={() => toggleGoal(opt)}
                  >
                    <span className={styles.chipLabel}>{opt}</span>
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: '1rem', color: goals.length > 0 ? '#10b981' : '#6b7280', fontWeight: 500, fontSize: '0.875rem' }}>
              {goals.length > 0 ? 'Great focus.' : 'Select at least 1 goal to continue.'}
            </div>
            
            <button onClick={() => handleNextSubStep(2)} className={styles.continueBtn} disabled={goals.length === 0}>
              Continue <ArrowRight className={styles.btnIcon} />
            </button>
          </motion.div>
        )}

        {subStep === 2 && (
          <motion.div key="dream" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} style={{ width: '100%' }}>
            <h2 className={styles.headline}>Dream Collaboration</h2>
            <p className={styles.subheadline}>If Meetifyy could introduce you to one perfect person tomorrow, who would it be?</p>
            <form onSubmit={(e) => { e.preventDefault(); if (dreamCollab.trim().length >= 3) handleNextSubStep('done'); }}>
              <input 
                type="text" 
                autoFocus 
                className={`${styles.largeInput} ${dreamCollab.length > 0 && dreamCollab.trim().length < 3 ? styles.inputError : ''}`} 
                placeholder="A co-founder who can code..." 
                value={dreamCollab} 
                onChange={(e) => setDreamCollab(e.target.value)} 
              />
              
              <div style={{ minHeight: '1.5rem', marginTop: '0.5rem', color: '#ef4444', fontSize: '0.875rem', fontWeight: 500 }}>
                {dreamCollab.length > 0 && dreamCollab.trim().length < 3 ? 'Please enter a valid description (at least 3 characters).' : ''}
              </div>

              <button type="submit" className={styles.continueBtn} disabled={dreamCollab.trim().length < 3}>
                Continue <ArrowRight className={styles.btnIcon} />
              </button>
            </form>
          </motion.div>
        )}

      </AnimatePresence>
    </AnimatedStep>
  );
}
