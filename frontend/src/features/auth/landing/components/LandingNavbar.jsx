import { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import wordmark from '@assets/images/meetifyy_wordmark.svg';
import { useAuth } from '@shared/context/AuthContext';
import '../landing.css';
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

  // While the menu is open the page behind it must not scroll, and Escape
  // closes it. The scroll is stopped at the input events rather than by
  // changing overflow on <html>: that removes the window's scrollbar, which
  // resizes the viewport and shifted the bar's contents out of line with the
  // menu's the moment it opened.
  const sheetRef = useRef(null);
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    const stopScroll = (e) => {
      const sheet = sheetRef.current;
      // The sheet scrolls itself on a short screen; only then let it through.
      const sheetScrolls = sheet && sheet.contains(e.target) && sheet.scrollHeight > sheet.clientHeight;
      if (!sheetScrolls) e.preventDefault();
    };
    // The menu is hidden by CSS from 960px up; close it there too.
    const wide = window.matchMedia('(min-width: 960px)');
    const onWide = (e) => { if (e.matches) setMenuOpen(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', stopScroll, { passive: false });
    window.addEventListener('touchmove', stopScroll, { passive: false });
    wide.addEventListener('change', onWide);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', stopScroll);
      window.removeEventListener('touchmove', stopScroll);
      wide.removeEventListener('change', onWide);
    };
  }, [menuOpen]);

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
    ['Join', '/#join'],
  ];

  const actions = (onNavigate, size = 'lp-btn--small') =>
    !authLoading &&
    (isLoggedIn ? (
      <Link className={`lp-btn lp-btn--solid ${size}`} to="/home" onClick={onNavigate}>
        Continue to Meetifyy
      </Link>
    ) : (
      <>
        <Link className={`lp-btn ${size}`} to="/login" onClick={onNavigate}>
          Log in
        </Link>
        <Link className={`lp-btn lp-btn--solid ${size}`} to="/signup" onClick={onNavigate}>
          Create account
        </Link>
      </>
    ));

  // The bar keeps whatever colour it has when the menu opens. The menu's
  // sheet takes that same colour instead (see .menuTop / .menuScrolled), so
  // the two are one surface and the bar never changes under the visitor.
  const headerClass = [styles.header, scrolled && styles.scrolled, menuOpen && styles.open].filter(Boolean).join(' ');

  return (
    <>
      <header className={headerClass}>
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
            className={styles.menuBtn}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
          >
            {menuOpen ? 'Close' : 'Menu'}
          </button>
        </div>
      </header>

      <AnimatePresence>
        {menuOpen && (
          <motion.div
            ref={sheetRef}
            /* Only opacity moves on the sheet itself; the links rise in with
               a CSS stagger (see .mobileNavLink), so nothing lays out again. */
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] } }}
            exit={{ opacity: 0, transition: { duration: 0.16, ease: 'easeIn' } }}
            className={`${styles.mobileMenu} ${scrolled ? styles.menuScrolled : styles.menuTop}`}
          >
            <nav className={styles.mobileNav} aria-label="Sections">
              {sections.map(([label, href], i) => (
                <a key={href} href={href} className={styles.mobileNavLink} style={{ '--i': i }} onClick={(e) => goToSection(e, href)}>
                  {label}
                </a>
              ))}
            </nav>
            <div className={styles.mobileActions}>{actions(() => setMenuOpen(false), '')}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
