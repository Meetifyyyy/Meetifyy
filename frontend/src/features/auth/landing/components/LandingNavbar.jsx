import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X } from '@shared/components/icons';
import wordmark from '@assets/images/meetifyy_wordmark.svg';
import { useAuth } from '@shared/context/AuthContext';
import styles from './LandingNavbar.module.css';

export default function LandingNavbar() {
  // This navbar is also used on info/footer pages (About, Terms, Privacy,
  // Contact, etc. — see StaticDocLayout), which stay reachable while logged
  // in, unlike the landing page itself. Reading live auth state here (not a
  // one-time snapshot) means the CTA swaps immediately on login/logout with
  // no refresh needed, everywhere this navbar is mounted.
  const { isLoggedIn, loading: authLoading } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <>
      <header className={`${styles.header} ${scrolled ? styles.scrolled : styles.top}`}>
        <div className={styles.inner}>
          {/* Logo */}
          {/*
            An anchor, not a button. This is the site-wide link back to the
            homepage and it appears on every public page, so as a button it was
            a dead end for a crawler walking the site from any page but the
            root. <Link> keeps the client-side navigation identical.
          */}
          <Link
            to="/"
            onClick={() => setMenuOpen(false)}
            className={styles.brand}
            aria-label="Meetifyy home"
          >
            <img src={wordmark} alt="Meetifyy" className={styles.wordmarkImg} />
          </Link>

          {/* Desktop CTAs */}
          <div className={styles.desktopActions}>
            {!authLoading && (
              isLoggedIn ? (
                <Link className={styles.ctaBtn} to="/home">
                  Continue
                </Link>
              ) : (
                <>
                  <Link className={styles.signInBtn} to="/login">
                    Sign In
                  </Link>
                  <Link className={styles.ctaBtn} to="/signup">
                    Create Account
                  </Link>
                </>
              )
            )}
          </div>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className={styles.hamburger}
            aria-label="Toggle menu"
          >
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </header>

      {/* Mobile full-screen menu */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className={styles.mobileMenu}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 15 }}
              transition={{ type: 'spring', stiffness: 200, damping: 20, delay: 0.05 }}
              className={styles.mobileMenuCard}
            >
              <div className={styles.mobileLogo}>
                <img src={wordmark} alt="Meetifyy" className={styles.mobileWordmarkImg} />
              </div>
              {!authLoading && (
                isLoggedIn ? (
                  <Link
                    to="/home"
                    onClick={() => setMenuOpen(false)}
                    className={styles.mobileCta}
                  >
                    Continue
                  </Link>
                ) : (
                  <>
                    <Link
                      to="/login"
                      onClick={() => setMenuOpen(false)}
                      className={styles.mobileSignIn}
                    >
                      Sign In
                    </Link>
                    <Link
                      to="/signup"
                      onClick={() => setMenuOpen(false)}
                      className={styles.mobileCta}
                    >
                      Create Account
                    </Link>
                  </>
                )
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
