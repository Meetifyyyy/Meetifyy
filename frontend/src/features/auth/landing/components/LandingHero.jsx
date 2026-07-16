import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import InteractiveHeroCollage from './InteractiveHeroCollage';
import AnimatedWordRotator from './AnimatedWordRotator';
import styles from './LandingHero.module.css';

export default function LandingHero() {
  const navigate = useNavigate();

  return (
    <section id="home" className={styles.section} role="banner">
      <InteractiveHeroCollage />
      <div className={styles.content}>
        {/* Animated headline */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.1 }}
          className={styles.headlineWrap}
        >
          <AnimatedWordRotator centered />
        </motion.div>

        {/* Description */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.2 }}
          className={styles.desc}
        >
          Connect, share stories, and build real friendships — all on one platform designed for campus life.
        </motion.p>

        {/* CTAs */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.3 }}
          className={styles.actions}
        >
          <button className={styles.primaryBtn} onClick={() => navigate('/signup')}>
            <span>Create your account</span>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={styles.btnIcon}>
              <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button 
            className={styles.secondaryBtn} 
            onClick={() => {
              const el = document.getElementById('how-it-works');
              if (el) el.scrollIntoView({ behavior: 'smooth' });
            }}
          >
            See how it works
          </button>
        </motion.div>
      </div>
    </section>
  );
}
