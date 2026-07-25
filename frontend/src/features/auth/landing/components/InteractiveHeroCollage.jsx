import { motion } from 'framer-motion';
import chaiCollab from '@assets/images/chai_collab.png';
import styles from './InteractiveHeroCollage.module.css';

function InteractiveCollageCard({ children, initialX, initialY, rotate, delay, className }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.85, y: 30 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.8, delay, type: 'spring', stiffness: 80, damping: 15 }}
      style={{ left: initialX, top: initialY, rotate }}
      className={className}
    >
      <motion.div
        whileHover={{ scale: 1.05 }}
        className={styles.cardInner}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

export default function InteractiveHeroCollage() {
  return (
    <div className={styles.root}>
      {/* Hand-drawn sketch grid */}
      <svg className={styles.grid}>
        <defs>
          <pattern id="handgrid" width="60" height="60" patternUnits="userSpaceOnUse">
            <path d="M 60 0 L 0 0 0 60" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="3 3" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#handgrid)" />
      </svg>

      <div className={styles.scene}>
        {/* Polaroid photo card — top left */}
        <InteractiveCollageCard
          initialX="10%"
          initialY="22%"
          rotate="-6deg"
          delay={0.2}
          className={`${styles.card} ${styles.cardVisible}`}
        >
          <div className={styles.polaroid}>
            {/* Tape strip */}
            <div
              className={styles.tape}
              style={{ clipPath: 'polygon(6% 0%, 94% 2%, 97% 88%, 91% 100%, 9% 96%, 3% 82%)' }}
            />
            <div className={styles.shine} />
            <div className={styles.photoFrame}>
              <img src={chaiCollab} alt="Chai & Collabs" className={styles.photo} />
              <div className={styles.photoOverlay} />
            </div>
            <div className={styles.caption}>
              <span className={`${styles.captionText} landing-font-handwriting`}>
                "Chai &amp; Collabs" ☕
              </span>
              <p className={styles.captionSub}>Campus Life</p>
            </div>
          </div>
        </InteractiveCollageCard>

        {/* No-bots label chip — top right */}
        <InteractiveCollageCard
          initialX="82%"
          initialY="35%"
          rotate="5deg"
          delay={0.5}
          className={`${styles.card} ${styles.cardXl}`}
        >
          <div className={styles.chip}>
            <div className={styles.chipSheen} />
            <span className={styles.chipDot} />
            <div className={styles.chipText}>
              <span className={`${styles.chipLabel} landing-font-handwriting`}>
                No bots. No spam. 🌿
              </span>
              <span className={styles.chipSub}>Pure Peer-to-Peer</span>
            </div>
          </div>
        </InteractiveCollageCard>

        {/* Hand-drawn loop arrow */}
        <svg
          className={styles.scribbleArrow}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M2 15C5 8 18 2 22 10C24 14 14 20 10 15C7 11 12 5 18 8" />
        </svg>

        {/* Star cluster */}
        <svg className={styles.scribbleStar} fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 1L14.4 7.6L21 8.2L16.2 12.8L17.7 19.5L12 16L6.3 19.5L7.8 12.8L3 8.2L9.6 7.6L12 1Z" />
        </svg>
      </div>
    </div>
  );
}
