import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import wordmark from '@assets/images/meetifyy_wordmark.svg';
import { useAuth } from '@shared/context/AuthContext';
import styles from './LandingNavbar.module.css';

/** Read by EditorialLanding on mount. */
export const LANDING_SCROLL_KEY = 'meetifyy:landing-scroll-to';

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

  const location = useLocation();
  const navigate = useNavigate();

  /**
   * The browser's own jump to `#id` does not happen here — the app manages
   * scrolling itself — so section links scroll explicitly. From another page
   * they navigate to `/#id`, and the landing page scrolls on arrival.
   */
  const goToSection = (event, href) => {
    event.preventDefault();
    setMenuOpen(false);
    const id = href.split('#')[1];
    if (location.pathname === '/') {
      // The URL is left alone: a raw history write would bypass the router
      // and desync SmartBackTracker's mirror of the stack.
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      // Handed over in storage, not the URL: SmartBackTracker collapses a
      // push to `/` onto the existing entry, which drops any hash.
      try { window.sessionStorage.setItem(LANDING_SCROLL_KEY, id); } catch { /* best effort */ }
      navigate('/');
    }
  };

  // Section links are absolute (`/#…`) because this header is also mounted
  // on the static info pages, where the sections are on another page.
  const sections = [
    ['How it works', '/#how-it-works'],
    ['Features', '/#features'],
    ['Circles', '/#circles'],
    ['Stories', '/#testimonials'],
  ];

  const actions = (onNavigate) =>
    !authLoading &&
    (isLoggedIn ? (
      <Link className={styles.ctaBtn} to="/home" onClick={onNavigate}>
        Continue to Meetifyy
      </Link>
    ) : (
      <>
        <Link className={styles.signInBtn} to="/login" onClick={onNavigate}>
          Log in
        </Link>
        <Link className={styles.ctaBtn} to="/signup" onClick={onNavigate}>
          Create account
        </Link>
      </>
    ));

  return (
    <>
      <header className={`${styles.header} ${scrolled ? styles.scrolled : ''}`}>
        <div className={styles.inner}>
          {/*
            An anchor, not a button: this is the site-wide link back to the
            homepage on every public page, and a crawler needs an href.
          */}
          <Link
            to="/"
            onClick={() => setMenuOpen(false)}
            className={styles.brand}
            aria-label="Meetifyy home"
          >
            <img src={wordmark} alt="Meetifyy" className={styles.wordmarkImg} />
          </Link>

          <nav className={styles.nav} aria-label="Sections">
            {sections.map(([label, href]) => (
              <a key={href} href={href} className={styles.navLink} onClick={(e) => goToSection(e, href)}>{label}</a>
            ))}
          </nav>

          <div className={styles.desktopActions}>{actions()}</div>

          <button
            type="button"
            onClick={() => setMenuOpen(!menuOpen)}
            className={styles.hamburger}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
          >
            {/* One drawn icon: the three lines morph into an X and back. */}
            <span className={`${styles.burger} ${menuOpen ? styles.burgerOpen : ''}`} aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </button>
        </div>
      </header>

      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className={styles.mobileMenu}
          >
            <nav className={styles.mobileNav} aria-label="Sections">
              {sections.map(([label, href]) => (
                <a key={href} href={href} className={styles.mobileNavLink} onClick={(e) => goToSection(e, href)}>
                  {label}
                </a>
              ))}
            </nav>
            <div className={styles.mobileActions}>{actions(() => setMenuOpen(false))}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
