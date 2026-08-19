import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X } from 'lucide-react';
import wordmark from '@assets/images/meetifyy_wordmark.svg';
import { useAuth } from '@shared/context/AuthContext';
import styles from './LandingNavbar.module.css';

export default function LandingNavbar() {
  const navigate = useNavigate();
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
          <button
            onClick={() => { navigate('/'); setMenuOpen(false); }}
            className={styles.brand}
            aria-label="Go to homepage"
          >
            <img src={wordmark} alt="Meetifyy" className={styles.wordmarkImg} />
          </button>

          {/* Desktop CTAs */}
          <div className={styles.desktopActions}>
            {!authLoading && (
              isLoggedIn ? (
                <button className={styles.ctaBtn} onClick={() => navigate('/home')}>
                  Continue
                </button>
              ) : (
                <>
                  <button className={styles.signInBtn} onClick={() => navigate('/login')}>
                    Sign In
                  </button>
                  <button className={styles.ctaBtn} onClick={() => navigate('/signup')}>
                    Create Account
                  </button>
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
                  <button
                    onClick={() => { navigate('/home'); setMenuOpen(false); }}
                    className={styles.mobileCta}
                  >
                    Continue
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => { navigate('/login'); setMenuOpen(false); }}
                      className={styles.mobileSignIn}
                    >
                      Sign In
                    </button>
                    <button
                      onClick={() => { navigate('/signup'); setMenuOpen(false); }}
                      className={styles.mobileCta}
                    >
                      Create Account
                    </button>
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
