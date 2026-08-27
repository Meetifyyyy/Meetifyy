import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, ArrowRight, School, Compass, X, Check, Loader2 } from '@shared/components/icons';
import wordmark from '@assets/images/meetifyy_wordmark.svg';
import styles from './SignupJourneyCTA.module.css';

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
  const [collegeInput, setCollegeInput] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Modal Form State
  const [name, setName] = useState('');
  const [collegeName, setCollegeName] = useState('');
  const [personalEmail, setPersonalEmail] = useState('');
  const [collegeEmail, setCollegeEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    // Automatically open modal when redirected from signup flow with request=college or #join
    const params = new URLSearchParams(window.location.search);
    if (params.get('request') === 'college' || window.location.hash === '#join') {
      setIsModalOpen(true);
      const section = document.getElementById('join');
      if (section) {
        section.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }, []);

  useEffect(() => {
    if (!isModalOpen) return;

    document.documentElement.classList.add('landing-modal-open');
    document.body.classList.add('landing-modal-open');

    return () => {
      document.documentElement.classList.remove('landing-modal-open');
      document.body.classList.remove('landing-modal-open');
    };
  }, [isModalOpen]);

  const handleOpenModal = (e) => {
    e.preventDefault();
    setCollegeName(collegeInput.trim());
    setErrorMsg(null);
    setIsSuccess(false);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setErrorMsg(null);
    setIsSuccess(false);
  };

  const handleModalSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!name.trim()) {
      setErrorMsg('Please enter your full name');
      return;
    }
    if (!collegeName.trim()) {
      setErrorMsg('Please enter your college name');
      return;
    }
    if (!personalEmail.trim() || !personalEmail.includes('@')) {
      setErrorMsg('Please enter a valid personal email address');
      return;
    }
    if (!collegeEmail.trim() || !collegeEmail.includes('@')) {
      setErrorMsg('Please enter a valid college email address');
      return;
    }

    setIsSubmitting(true);
    try {
      // Check if domain is already whitelisted by checking the email
      const checkRes = await fetch('/api/auth/check-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: collegeEmail.trim().toLowerCase() }),
      });
      const checkData = await checkRes.json();

      // If available is true, or if it says it's already registered, it means the domain IS whitelisted.
      if (checkData.available === true || checkData.reason === 'This email is already registered. Please sign in.') {
        setErrorMsg('Your college is already added to Meetifyy! You can sign up directly.');
        setIsSubmitting(false);
        return;
      }

      // If domain is not whitelisted, submit the request
      const res = await fetch('/api/auth/request-college', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          collegeName: collegeName.trim(),
          personalEmail: personalEmail.trim().toLowerCase(),
          collegeEmail: collegeEmail.trim().toLowerCase(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        let msg = data.message || 'Failed to submit campus request';
        if (Array.isArray(msg)) msg = msg[0];
        throw new Error(msg);
      }

      setIsSuccess(true);
    } catch (err) {
      setErrorMsg(err.message || 'Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
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

        {/* Add College Call-To-Action Form Container */}
        <motion.div
          variants={formVariants}
          className={styles.formContainer}
        >
          <form onSubmit={handleOpenModal} className={styles.form}>
            <input
              id="cta-college"
              name="college"
              type="text"
              autoComplete="organization"
              aria-label="College name"
              value={collegeInput}
              onChange={(e) => setCollegeInput(e.target.value)}
              placeholder="Enter your college name"
              className={styles.input}
            />
            <button
              type="submit"
              className={`${styles.submitBtn} ${styles.notSubmitted}`}
            >
              <span className={styles.btnContent}>
                <span className={styles.btnTextFull}>Add your college</span>
                <span className={styles.btnTextShort}>Add</span>
                <ArrowRight size={16} />
              </span>
            </button>
          </form>

          <p className={styles.disclaimer}>
            Don&apos;t see your institution listed? Request your college domain to get instant access.
          </p>
        </motion.div>
      </motion.div>

      {/* Campus Request Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <motion.div
            className={styles.modalBackdrop}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleCloseModal}
          >
            <motion.div
              className={styles.modalCard}
              initial={{ y: '100%', opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 220 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className={styles.modalHeader}>
                <div>
                  <h3 className={styles.modalTitle}>
                    Bring <img src={wordmark} alt="Meetifyy" className={styles.titleWordmark} /> To Your Campus 🚀
                  </h3>
                  <p className={styles.modalSubtitle}>
                    Submit your college domain details. Our admin team will verify and enable your campus whitelist.
                  </p>
                </div>
                <button type="button" onClick={handleCloseModal} className={styles.closeBtn}>
                  <X size={16} />
                </button>
              </div>

              {isSuccess ? (
                <div className={styles.successView}>
                  <div className={styles.successIcon}>
                    <Check size={28} />
                  </div>
                  <h4 className={styles.successTitle}>
                    Request Submitted! 🎉
                  </h4>
                  <p className={styles.successText}>
                    We will verify your institutional details and notify you at <strong>{personalEmail}</strong> as soon as there is any update.
                  </p>
                  <button type="button" onClick={handleCloseModal} className={styles.modalSubmitBtn}>
                    Got it!
                  </button>
                </div>
              ) : (
                <form onSubmit={handleModalSubmit} className={styles.modalForm}>
                  {errorMsg && <div className={styles.errorBox}>{errorMsg}</div>}

                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel} htmlFor="cta-name">Full Name</label>
                    <input
                      id="cta-name"
                      name="name"
                      type="text"
                      autoComplete="name"
                      required
                      minLength={2}
                      maxLength={80}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className={styles.fieldInput}
                    />
                  </div>

                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel} htmlFor="cta-college-name">College / University Name</label>
                    <input
                      id="cta-college-name"
                      name="collegeName"
                      type="text"
                      autoComplete="organization"
                      required
                      minLength={3}
                      maxLength={120}
                      value={collegeName}
                      onChange={(e) => setCollegeName(e.target.value)}
                      className={styles.fieldInput}
                    />
                  </div>

                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel} htmlFor="cta-personal-email">Personal Email</label>
                    <input
                      id="cta-personal-email"
                      name="personalEmail"
                      type="email"
                      autoComplete="email"
                      required
                      maxLength={100}
                      value={personalEmail}
                      onChange={(e) => setPersonalEmail(e.target.value)}
                      className={styles.fieldInput}
                    />
                  </div>

                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel} htmlFor="cta-college-email">College Email</label>
                    <input
                      id="cta-college-email"
                      name="collegeEmail"
                      type="email"
                      autoComplete="email"
                      required
                      maxLength={100}
                      value={collegeEmail}
                      onChange={(e) => setCollegeEmail(e.target.value)}
                      className={styles.fieldInput}
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className={styles.modalSubmitBtn}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 size={18} className="animate-spin" /> Submitting...
                      </>
                    ) : (
                      <>
                        Request Campus Access ✨
                      </>
                    )}
                  </button>
                </form>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
