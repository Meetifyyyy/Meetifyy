import React, { useState } from 'react';
import { useSignup } from '../SignupContext';
import AnimatedStep from './AnimatedStep';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, GraduationCap } from 'lucide-react';
import styles from '../SignupFlow.module.css';

export default function Step3Student() {
  const { signupData, updateData, nextStep } = useSignup();
  const [subStep, setSubStep] = useState(1);
  
  const [university, setUniversity] = useState(signupData.university || '');
  const [course, setCourse] = useState(signupData.course || '');
  const [branch, setBranch] = useState(signupData.branch || '');
  const [year, setYear] = useState(signupData.year || '');

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
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem', color: 'var(--color-primary, #6366f1)' }}>
        <GraduationCap size={24} />
        <span style={{ fontWeight: 600 }}>Meetifyy is built for verified students.</span>
      </div>

      <AnimatePresence mode="wait">
        {subStep === 1 && (
          <motion.div key="university" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} style={{ width: '100%' }}>
            <h2 className={styles.headline}>Where do you study?</h2>
            <form onSubmit={(e) => { e.preventDefault(); if (university) advance('university', university, 2); }}>
              <input type="text" autoFocus className={styles.largeInput} placeholder="e.g. Stanford University" value={university} onChange={(e) => setUniversity(e.target.value)} />
              <button type="submit" className={styles.continueBtn} disabled={university.trim().length < 3}>
                Continue <ArrowRight className={styles.btnIcon} />
              </button>
            </form>
          </motion.div>
        )}

        {subStep === 2 && (
          <motion.div key="course" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} style={{ width: '100%' }}>
            <h2 className={styles.headline}>What's your degree?</h2>
            <form onSubmit={(e) => { e.preventDefault(); if (course) advance('course', course, 3); }}>
              <input type="text" autoFocus className={styles.largeInput} placeholder="e.g. B.Tech, BSc, BA" value={course} onChange={(e) => setCourse(e.target.value)} />
              <button type="submit" className={styles.continueBtn} disabled={course.trim().length < 2}>
                Continue <ArrowRight className={styles.btnIcon} />
              </button>
            </form>
          </motion.div>
        )}

        {subStep === 3 && (
          <motion.div key="branch" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} style={{ width: '100%' }}>
            <h2 className={styles.headline}>Which specialization?</h2>
            <form onSubmit={(e) => { e.preventDefault(); if (branch) advance('branch', branch, 4); }}>
              <input type="text" autoFocus className={styles.largeInput} placeholder="e.g. Computer Science" value={branch} onChange={(e) => setBranch(e.target.value)} />
              <button type="submit" className={styles.continueBtn} disabled={branch.trim().length < 2}>
                Continue <ArrowRight className={styles.btnIcon} />
              </button>
            </form>
          </motion.div>
        )}

        {subStep === 4 && (
          <motion.div key="year" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} style={{ width: '100%' }}>
            <h2 className={styles.headline}>Current Year</h2>
            <div className={styles.optionsGrid} style={{ marginTop: '2rem' }}>
              {['1st Year', '2nd Year', '3rd Year', '4th Year', 'Masters / PhD'].map(y => (
                <div 
                  key={y} 
                  className={`${styles.optionChip} ${year === y ? styles.selected : ''}`} 
                  onClick={() => setYear(y)}
                >
                  <span className={styles.chipLabel}>{y}</span>
                </div>
              ))}
            </div>
            <button onClick={() => advance('year', year, 'done')} className={styles.continueBtn} disabled={!year}>
              Continue <ArrowRight className={styles.btnIcon} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </AnimatedStep>
  );
}
