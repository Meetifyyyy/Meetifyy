import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import styles from './AnimatedWordRotator.module.css';

const WORDS = ['People.', 'Crew.', 'Tribe.', 'Circle.', 'Community.'];

export default function AnimatedWordRotator({ centered = false }) {
  const containerRef = useRef(null);
  const [fontSize, setFontSize] = useState(60);
  const [wordIndex, setWordIndex] = useState(0);

  useEffect(() => {
    const handleResize = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const containerWidth = rect.width || 540;
      const computedFontSize = Math.min(containerWidth * 0.165, 104);
      setFontSize(computedFontSize);
    };

    handleResize();
    window.addEventListener('resize', handleResize);

    const interval = setInterval(() => {
      setWordIndex((prev) => (prev + 1) % WORDS.length);
    }, 2800);

    return () => {
      window.removeEventListener('resize', handleResize);
      clearInterval(interval);
    };
  }, []);

  const containerVariants = {
    hidden: {},
    visible: { transition: { staggerChildren: 0.04 } },
    exit: { transition: { staggerChildren: 0.02, staggerDirection: -1 } },
  };

  const letterVariants = {
    hidden: { y: '100%', rotate: 8, opacity: 0, scale: 0.9 },
    visible: {
      y: '0%', rotate: 0, opacity: 1, scale: 1,
      transition: { type: 'spring', stiffness: 140, damping: 14, mass: 0.6 },
    },
    exit: {
      y: '-100%', rotate: -8, opacity: 0, scale: 0.9,
      transition: { duration: 0.25, ease: [0.76, 0, 0.24, 1] },
    },
  };

  const activeWord = WORDS[wordIndex];
  const characters = activeWord.split('');

  return (
    <div
      ref={containerRef}
      className={`${styles.root} ${centered ? styles.centered : ''}`}
    >
      <h1
        className={`${styles.headline} landing-font-display`}
        style={{ fontSize: `${fontSize}px` }}
      >
        Meet your
        <span className={styles.headlineAssistive}> {WORDS[0]}</span>
      </h1>

      {/*
        Decorative as far as assistive technology is concerned: the word it
        cycles through is already in the H1 above, and announcing a per-letter
        animation that restarts every 2.8 seconds is noise, not information.
      */}
      <div
        aria-hidden="true"
        className={`${styles.wordContainer} ${centered ? styles.wordCentered : ''}`}
        style={{ height: `${fontSize * 1.3}px` }}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={activeWord}
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className={`${styles.wordInner} ${centered ? styles.wordInnerCentered : ''} landing-font-display`}
            style={{ fontSize: `${fontSize}px`, perspective: '800px' }}
          >
            {characters.map((char, index) => {
              const isPeriod = char === '.' && index === characters.length - 1;
              return (
                <motion.span
                  key={`${index}-${char}`}
                  variants={letterVariants}
                  className={`${styles.letter} ${isPeriod ? styles.period : ''}`}
                >
                  {char}
                </motion.span>
              );
            })}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
