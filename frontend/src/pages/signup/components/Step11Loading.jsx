import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext';
import { useSignup } from '../SignupContext';
import AnimatedStep from './AnimatedStep';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import styles from '../SignupFlow.module.css';

const loadingMessages = [
  'Finding creators...',
  'Finding coders...',
  'Finding entrepreneurs...',
  'Matching interests...',
  'Matching goals...',
  'Preparing recommendations...'
];

export default function Step11Loading() {
  const { signupData } = useSignup();
  const { signup } = useAuth();
  const navigate = useNavigate();
  
  const [msgIndex, setMsgIndex] = useState(0);
  const [isDone, setIsDone] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setMsgIndex((prev) => {
        if (prev < loadingMessages.length - 1) return prev + 1;
        return prev;
      });
    }, 800);

    const timer = setTimeout(() => {
      clearInterval(interval);
      setIsDone(true);
      // Simulate backend call completion and mock signup
      const mockUsername = signupData.username || `${signupData.firstName || 'user'}${Math.floor(Math.random()*1000)}`;
      signup({ ...signupData, username: mockUsername });
    }, 5000);

    return () => {
      clearInterval(interval);
      clearTimeout(timer);
    };
  }, [signupData, signup]);

  return (
    <AnimatedStep className={styles.stepWrapper} style={{ alignItems: 'center', textAlign: 'center' }}>
      <AnimatePresence mode="wait">
        
        {!isDone ? (
          <motion.div key="building" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ width: '100%', padding: '4rem 0' }}>
            <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 2, ease: "linear" }} style={{ display: 'inline-block', color: '#6366f1', marginBottom: '2rem' }}>
              <Loader2 size={64} />
            </motion.div>
            <h2 className={styles.headline}>Building your Meetifyy profile...</h2>
            <motion.p 
              key={msgIndex}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className={styles.subheadline}
              style={{ marginTop: '1rem', color: '#8b5cf6', fontWeight: 500 }}
            >
              {loadingMessages[msgIndex]}
            </motion.p>
          </motion.div>
        ) : (
          <motion.div key="welcome" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} style={{ width: '100%', padding: '2rem 0' }}>
            <h1 className={styles.headline} style={{ fontSize: '3rem', marginBottom: '1.5rem' }}>Welcome to Meetifyy</h1>
            <p className={styles.subheadline} style={{ fontSize: '1.25rem', color: '#111827', fontWeight: 600 }}>
              Your campus is bigger than your classroom.<br/>
              <span style={{ color: '#6366f1' }}>Let's find your people.</span>
            </p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '3rem', alignItems: 'center' }}>
              <button 
                className={styles.continueBtn} 
                style={{ marginTop: 0, width: '100%', maxWidth: '300px', justifyContent: 'center' }}
                onClick={() => navigate('/home')}
              >
                Start Discovering
              </button>
              <button 
                className={styles.backButton} 
                style={{ fontSize: '1rem' }}
                onClick={() => navigate(`/profile/${signupData.username || ''}`)}
              >
                View My Profile
              </button>
            </div>
          </motion.div>
        )}

      </AnimatePresence>
    </AnimatedStep>
  );
}
