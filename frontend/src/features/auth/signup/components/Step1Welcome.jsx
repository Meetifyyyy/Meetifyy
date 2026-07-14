import React from 'react';
import { useSignup } from '../SignupContext';
import AnimatedStep from './AnimatedStep';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import styles from '../SignupFlow.module.css';

export default function Step1Welcome() {
  const { nextStep } = useSignup();

  return (
    <AnimatedStep className={styles.stepWrapper} style={{ alignItems: 'center', textAlign: 'center', justifyContent: 'center', minHeight: '60vh' }}>

      <motion.h1 
        className={styles.headline}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        Your next best friend, co-founder, teammate, mentor, or event buddy might already be here.
      </motion.h1>
      
      <motion.p 
        className={styles.subheadline}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        Let's create your Meetifyy account.
      </motion.p>

      <motion.button 
        className={styles.continueBtn}
        onClick={nextStep}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
        Get Started
        <ArrowRight className={styles.btnIcon} />
      </motion.button>

    </AnimatedStep>
  );
}
