import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check, Loader2 } from '@shared/components/icons';
import guitar from '../assets/guitar.webp';
import laptopPair from '../assets/laptop-pair.webp';
import '../landing.css';
import styles from './SignupJourneyCTA.module.css';
import { apiClient } from '@shared/api/apiClient';

/** The one message shown when nothing more specific is safe to say. */
const GENERIC_ERROR = 'Something went wrong. Please try again.';

/**
 * Turn any thrown value into copy a visitor should read.
 *
 * The rule is deliberately an allow-list, not a deny-list: a message reaches
 * the screen only when it comes from a status this endpoint answers with
 * human-written copy. Everything else — parser failures, 404s from a
 * misrouted request, 5xx, a dropped connection — collapses to one neutral
 * sentence, because those messages are written for developers and some of
 * them (`Unexpected token 'T', "The page c"...`) are pure noise to a person
 * trying to register their college.
 *
 *   400  the server's own validation copy, e.g. "Please enter a valid full
 *        name (2-80 characters)." — written to be read by the person filling
 *        the form, and the counterpart to the client-side checks above.
 *   429  rate limited; the server sends a human message and how long to wait.
 *
 * Anything else is generic. `err.status` is attached by apiClient.
 */
function campusRequestErrorMessage(err) {
  const status = err?.status;

  if (status === 429) {
    const wait = err?.retryAfterSeconds;
    if (Number.isFinite(wait) && wait > 0) {
      const mins = Math.ceil(wait / 60);
      return wait < 60
        ? `Too many requests. Please try again in ${Math.ceil(wait)} seconds.`
        : `Too many requests. Please try again in ${mins} minute${mins === 1 ? '' : 's'}.`;
    }
    return 'Too many requests. Please try again in a little while.';
  }

  if (status === 400) {
    let msg = err?.message;
    // A validation failure can arrive as an array of messages; show the first.
    if (Array.isArray(msg)) msg = msg[0];
    // Guard against a 400 whose body was empty: apiClient falls back to
    // "API error 400", which is exactly the kind of string this exists to keep
    // off the screen.
    if (typeof msg === 'string' && msg.trim() && !/^API error\b/.test(msg)) {
      return msg;
    }
  }

  return GENERIC_ERROR;
}

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
      /**
       * Both calls go through `apiClient`, not bare `fetch`.
       *
       * They used to be `fetch('/api/auth/check-email')` — a same-origin,
       * relative URL. That works in local development only because the Vite
       * dev server proxies `/api` to the backend (see `server.proxy` in
       * vite.config.js). On the deployed site there is no such proxy: the API
       * lives on its own host, and `vercel.json` rewrites only `/_api/*`,
       * `/api/media/*` and `/api/share/*` — while the SPA catch-all
       * deliberately EXCLUDES `api/`. So `POST /api/auth/check-email` matched
       * nothing, and Vercel answered with its own 404: status 404,
       * `content-type: text/plain`, body `The page could not be found`.
       * `res.json()` on that threw
       * `Unexpected token 'T', "The page c"... is not valid JSON`, which the
       * catch below then printed on screen.
       *
       * `apiClient` resolves the correct API origin for every environment —
       * localhost in dev, the configured API host in production — which is why
       * every other caller of this same endpoint has always worked.
       */

      /**
       * Best-effort courtesy check: is this college already on Meetifyy?
       *
       * Deliberately not allowed to fail the submission. If the availability
       * check itself errors, the right outcome is to go ahead and file the
       * request — dead-ending someone on a check that is only there to save
       * them a step would be worse than a duplicate request for the admin team
       * to dismiss.
       */
      let checkData = null;
      try {
        checkData = await apiClient.post('/api/auth/check-email', {
          email: collegeEmail.trim().toLowerCase(),
        });
      } catch (checkErr) {
        console.error('[campus-request] email availability check failed', checkErr);
      }

      // Signup takes any address now, so `available` says nothing about the
      // college. A known college domain comes back as a hint (`collegeName`
      // / `collegeId`); only that means the college is already here.
      if (checkData && (checkData.collegeId || checkData.collegeName)) {
        setErrorMsg(
          `${checkData.collegeName || 'Your college'} is already on Meetifyy. Sign up, then verify your college email on Campus.`,
        );
        setIsSubmitting(false);
        return;
      }

      // Not a known college domain: file the request
      await apiClient.post('/api/auth/request-college', {
        name: name.trim(),
        collegeName: collegeName.trim(),
        personalEmail: personalEmail.trim().toLowerCase(),
        collegeEmail: collegeEmail.trim().toLowerCase(),
      });

      setIsSuccess(true);
    } catch (err) {
      // The technical detail goes to the console, and only to the console.
      console.error('[campus-request] submission failed', err);
      setErrorMsg(campusRequestErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section id="join" className={styles.section} aria-labelledby="join-title">
      <div className={styles.inner}>
        <p className={styles.kicker}>Join</p>
        <h2 id="join-title" className={styles.title}>
          ready when <span className={styles.serif}>you are.</span>
        </h2>

        <div className={styles.joinGrid}>
          <div className={`${styles.block} ${styles.blockInk}`}>
            <div className={`${styles.blockArt} ${styles.artCircle}`}>
              <img src={guitar} alt="A student playing an acoustic guitar outdoors" width="1400" height="933" loading="lazy" decoding="async" />
            </div>
            <h3 className={styles.blockTitle}>sign up with any email.</h3>
            <p className={styles.blockText}>
              Personal or college, set up your profile and you are in. Verify
              your college email later to open your Campus.
            </p>
            <Link to="/signup" className={`lp-btn lp-btn--solid ${styles.blockBtn}`}>Create your account</Link>
          </div>

          <div className={`${styles.block} ${styles.blockPaper}`}>
            <div className={`${styles.blockArt} ${styles.artLeaf}`}>
              <img src={laptopPair} alt="Two students working on a laptop at a cafe" width="800" height="1066" loading="lazy" decoding="async" />
            </div>
            <h3 className={styles.blockTitle}>want your college&apos;s Campus on Meetifyy?</h3>
            <p className={styles.blockText}>
              Tell us where you study. We verify the college&apos;s email domain
              and let you know when its Campus is live.
            </p>
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
              <button type="submit" className={`lp-btn lp-btn--solid ${styles.submitBtn}`}>
                Add your college
              </button>
            </form>
            <p className={styles.disclaimer}>
              You can sign up today either way. This only adds your college&apos;s Campus.
            </p>
          </div>
        </div>
      </div>

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
              <div className={styles.sheetHandle} aria-hidden="true" />
              <div className={styles.modalHeader}>
                <div>
                  <span className={styles.modalEyebrow}>Campus request</span>
                  <h3 className={styles.modalTitle}>Bring Campus to your college</h3>
                  <p className={styles.modalSubtitle}>
                    Tell us where you study. We verify the college&apos;s email
                    domain and email you when its Campus opens.
                  </p>
                </div>
                <button type="button" onClick={handleCloseModal} className={styles.closeBtn} aria-label="Close">
                  <X size={16} />
                </button>
              </div>

              {isSuccess ? (
                <div className={styles.successView}>
                  <div className={styles.successIcon}>
                    <Check size={28} />
                  </div>
                  <h4 className={styles.successTitle}>You&apos;re on the list</h4>
                  <p className={styles.successText}>
                    We will verify your college&apos;s details and email <strong>{personalEmail}</strong> when its Campus is live.
                  </p>
                  <button type="button" onClick={handleCloseModal} className={`lp-btn lp-btn--solid ${styles.modalSubmitBtn}`}>
                    Done
                  </button>
                </div>
              ) : (
                <form onSubmit={handleModalSubmit} className={styles.modalForm}>
                  {errorMsg && <div className={styles.errorBox}>{errorMsg}</div>}

                  <div className={styles.fieldGrid}>

                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel} htmlFor="cta-name">Full name</label>
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
                      placeholder="Your name"
                      className={styles.fieldInput}
                    />
                  </div>

                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel} htmlFor="cta-college-name">College or university</label>
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
                      placeholder="e.g. Delhi University"
                      className={styles.fieldInput}
                    />
                  </div>

                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel} htmlFor="cta-personal-email">Personal email</label>
                    <input
                      id="cta-personal-email"
                      name="personalEmail"
                      type="email"
                      autoComplete="email"
                      required
                      maxLength={100}
                      value={personalEmail}
                      onChange={(e) => setPersonalEmail(e.target.value)}
                      placeholder="you@gmail.com"
                      className={styles.fieldInput}
                    />
                    <span className={styles.fieldHint}>We will tell you here when your Campus is live.</span>
                  </div>

                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel} htmlFor="cta-college-email">College email</label>
                    <input
                      id="cta-college-email"
                      name="collegeEmail"
                      type="email"
                      autoComplete="email"
                      required
                      maxLength={100}
                      value={collegeEmail}
                      onChange={(e) => setCollegeEmail(e.target.value)}
                      placeholder="you@college.edu.in"
                      className={styles.fieldInput}
                    />
                    <span className={styles.fieldHint}>The address your college gave you.</span>
                  </div>

                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className={`lp-btn lp-btn--solid ${styles.modalSubmitBtn}`}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 size={18} className="animate-spin" /> Submitting...
                      </>
                    ) : (
                      <>
                        Request campus access
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
