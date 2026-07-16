import { useState } from 'react';
import { motion } from 'framer-motion';
import { Sparkles, ArrowRight, Check, School, Compass } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import styles from './SignupJourneyCTA.module.css';

const containerVariants = {
  hidden: {},
  visible: {}
};

const titleVariants = {
  hidden: { opacity: 0, y: 25 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, delay: 0.1 }
  }
};

const subtitleVariants = {
  hidden: { opacity: 0, y: 15 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, delay: 0.2 }
  }
};

const cardAVariants = {
  hidden: { opacity: 0, x: -30 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { type: 'spring', stiffness: 80, delay: 0.3 }
  }
};

const cardBVariants = {
  hidden: { opacity: 0, x: 30 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { type: 'spring', stiffness: 80, delay: 0.4 }
  }
};

const emergingLeftVariants = {
  hidden: { y: 90, x: -64, rotate: -12, opacity: 0 },
  visible: {
    y: 0,
    x: -64,
    rotate: -8,
    opacity: 1,
    transition: { type: 'spring', stiffness: 90, damping: 15, delay: 0.45 }
  }
};

const emergingRightVariants = {
  hidden: { y: 90, x: 64, rotate: 12, opacity: 0 },
  visible: {
    y: -15,
    x: 64,
    rotate: 6,
    opacity: 1,
    transition: { type: 'spring', stiffness: 90, damping: 15, delay: 0.5 }
  }
};

const formVariants = {
  hidden: { opacity: 0, y: 15 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, delay: 0.45 }
  }
};

export default function SignupJourneyCTA() {
  const [email, setEmail] = useState('');
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [placeholder, setPlaceholder] = useState('Enter your college email');
  const navigate = useNavigate();

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!email || !email.includes('@')) {
      return;
    }
    
    navigate('/signup', { state: { email } });
  };

  return (
    <section
      id="join"
      className={styles.section}
      aria-label="Create your account"
    >
      {/* Ambient Grid Background */}
      <div className={styles.gridOverlay} aria-hidden="true" />

      {/* Decorative Emojis */}
      <div className={styles.emojisContainer} aria-hidden="true">
        <div className={`${styles.emoji} ${styles.emojiRocket}`}>🚀</div>
        <div className={`${styles.emoji} ${styles.emojiGrad}`}>🎓</div>
        <div className={`${styles.emoji} ${styles.emojiChat}`}>💬</div>
        <div className={`${styles.emoji} ${styles.emojiTarget}`}>🎯</div>
      </div>

      <motion.div
        className={styles.container}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.15 }}
        variants={containerVariants}
      >
        {/* Layered Heading */}
        <motion.h2
          variants={titleVariants}
          className={`${styles.title} landing-font-display`}
        >
          If you struggle <br className={styles.breakSm} /> to find{' '}
          <span className={styles.badgeWrapper}>
            <Sparkles className={styles.sparklesIcon} />
          </span>{' '}
          your <br />
          people,{' '}
          <span className={styles.titleGradient}>
            join Meetifyy
            <svg className={styles.underlineSvg} viewBox="0 0 100 10" preserveAspectRatio="none">
              <path d="M 3 8 C 30 7, 70 8, 97 4 C 60 7.5, 20 8.5, 5 9" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
            </svg>
          </span>
        </motion.h2>

        <motion.p
          variants={subtitleVariants}
          className={styles.subtitle}
        >
          Your campus life is too short to spend alone. Discover active circles, find study crews, and meet people who actually get you.
        </motion.p>

        {/* Symmetrical Journey Cards */}
        <div className={styles.journeyWrapper}>
          {/* Symmetrical dotted journey vector line */}
          <div className={styles.dottedLineWrapper} aria-hidden="true">
            <svg width="240" height="80" viewBox="0 0 240 80" className={styles.dottedLineSvg}>
              <path
                d="M10 40 C 70 10, 170 70, 230 40"
                stroke="#5C47FA"
                strokeWidth="2"
                strokeDasharray="6 6"
                strokeLinecap="round"
              />
              <polygon points="230,40 220,35 222,40 220,45" fill="#5C47FA" />
            </svg>
          </div>

          {/* Point A Card */}
          <motion.div
            variants={cardAVariants}
            whileHover={{ y: -12, transition: { duration: 0.2 } }}
            className={`${styles.journeyCard} ${styles.cardA} group`}
          >
            <div className={styles.cardEmojiBadge}>🙁</div>
            <div>
              <span className={styles.cardEyebrow}>POINT A</span>
              <h3 className={`${styles.cardHeading} landing-font-display`}>Isolated Campus Life</h3>
              <p className={styles.cardText}>
                Lost in large lecture halls, dining solo, or spending quiet weekends alone.
              </p>
            </div>
          </motion.div>

          {/* Point B Card */}
          <motion.div
            variants={cardBVariants}
            whileHover={{ y: -12, transition: { duration: 0.2 } }}
            className={`${styles.journeyCard} ${styles.cardB} group`}
          >
            <div className={styles.cardEmojiBadgeB}>😊</div>
            <div>
              <span className={styles.cardEyebrowB}>POINT B</span>
              <h3 className={`${styles.cardHeading} landing-font-display`}>Active Student Circles</h3>
              <p className={styles.cardTextB}>
                Belonging to active niche study crews, dinner tribes, and weekend plans.
              </p>
            </div>
          </motion.div>
        </div>

        {/* Lower Emerging Cards Graphic */}
        <div className={styles.emergingCardsContainer} aria-hidden="true">
          <div className={styles.emergingCardsInner}>
            {/* Left Card: Your Campus */}
            <motion.div
              variants={emergingLeftVariants}
              className={`${styles.emergingCard} ${styles.emergingLeft}`}
            >
              <div className={styles.emergingHeader}>
                <span className={styles.emergingEyebrow}>YOUR CAMPUS</span>
                <span className={`${styles.pulseDot} ${styles.pulseRose}`} />
              </div>
              <div className={styles.emergingBody}>
                <School className={styles.emergingIconRose} />
                <p className={styles.emergingTextRose}>
                  One campus.<br />Many connections.
                </p>
              </div>
              <div className={styles.spacer} />
            </motion.div>

            {/* Right Card: Your Journey */}
            <motion.div
              variants={emergingRightVariants}
              className={`${styles.emergingCard} ${styles.emergingRight}`}
            >
              <div className={styles.emergingHeader}>
                <span className={styles.emergingEyebrowB}>YOUR JOURNEY</span>
                <span className={`${styles.pulseDot} ${styles.pulseGreen}`} />
              </div>
              <div className={styles.emergingBody}>
                <Compass className={styles.emergingIconBlue} />
                <p className={styles.emergingTextWhite}>
                  Your People.<br />Your Tribe.<br />Your Journey.
                </p>
              </div>
              <div className={styles.spacer} />
            </motion.div>
          </div>
        </div>

        {/* Account creation call-to-action form container */}
        <motion.div
          variants={formVariants}
          className={styles.formContainer}
        >
          <form onSubmit={handleSubmit} className={styles.form}>
            <input
              type="email"
              value={email}
              disabled={isSubmitted}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={placeholder}
              className={styles.input}
              required
            />
            <button
              type="submit"
              disabled={isSubmitted}
              className={`${styles.submitBtn} ${isSubmitted ? styles.submitted : styles.notSubmitted}`}
            >
              {isSubmitted ? (
                <span className={styles.btnContent}>
                  <Check size={16} /> Account Created
                </span>
              ) : (
                <span className={styles.btnContent}>
                  Sign Up <ArrowRight size={16} />
                </span>
              )}
            </button>
          </form>

          <p className={styles.disclaimer}>
            Join using your verified university email to connect with student circles instantly.
          </p>
        </motion.div>
      </motion.div>
    </section>
  );
}
