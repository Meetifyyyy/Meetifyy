import { Link } from 'react-router-dom';
import { useCookieConsent } from '@shared/context/CookieConsentContext';
import logoImg from '@assets/images/meetify_logo.webp';
import wordmarkImg from '@assets/images/meetifyy_wordmark.svg';
import styles from './LandingFooter.module.css';

export default function LandingFooter() {
  const { openPreferences } = useCookieConsent();

  /**
   * These were `<button onClick={navigate(...)}>`, which is why none of the
   * site's internal links were crawlable: a button has no href, so a crawler
   * reading the footer found no route out of the homepage to About, Help or any
   * of the legal pages. Those six links are the entire internal link graph of
   * the public site, and without them every page but the homepage was
   * discoverable only from the sitemap.
   *
   * `<Link>` renders a real anchor and still navigates client-side, so nothing
   * about the in-app behaviour changes. The scroll-to-top that `handleNav` used
   * to do explicitly is kept here rather than dropped, because ScrollRestoration
   * preserves position by default and these are long documents.
   */
  const toTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });

  return (
    <footer id="about" className={styles.footer} role="contentinfo">
      <div className={styles.container}>
        {/* Main Footer Grid */}
        <div className={styles.mainGrid}>
          {/* Left Column: Brand Icon, Social Links */}
          <div className={styles.leftCol}>
            <Link
              to="/"
              onClick={toTop}
              className={styles.logoBtn}
              aria-label="Meetifyy home"
            >
              <img src={logoImg} alt="Meetifyy" className={styles.logoImg} />
            </Link>

            {/* Social Icons */}
            <div className={styles.socialSection}>
              <span className={styles.sectionLabel}>Social</span>
              <div className={styles.socialIcons} aria-label="Social media links">
                {/* Instagram */}
                <a
                  href="https://www.instagram.com/meetifyy.in?igsi=YzVoZ3drN29id2tn"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.socialIcon}
                  aria-label="Instagram"
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="2" y="2" width="20" height="20" rx="5" />
                    <circle cx="12" cy="12" r="4" />
                    <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
                  </svg>
                </a>
                {/* LinkedIn */}
                <a
                  href="https://www.linkedin.com/company/meetifyy/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.socialIcon}
                  aria-label="LinkedIn"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M16 8a6 6 0 016 6v7h-4v-7a2 2 0 00-2-2 2 2 0 00-2 2v7h-4v-7a6 6 0 016-6zM2 9h4v12H2z" />
                    <circle cx="4" cy="4" r="2" />
                  </svg>
                </a>
              </div>
            </div>
          </div>

          {/* Right Navigation Columns */}
          <div className={styles.rightNavGrid}>
            <div className={styles.navCol}>
              {/* h2, not h4: these are the only headings in the contentinfo
                  landmark, and jumping straight to h4 skipped two levels for no
                  visual gain. .colTitle sets size, weight and margin, so the
                  rendered result is identical. */}
              <h2 className={styles.colTitle}>Company</h2>
              <ul className={styles.linkList}>
                <li>
                  <Link to="/about" onClick={toTop} className={styles.linkBtn}>
                    About Us
                  </Link>
                </li>
                <li>
                  <Link to="/help-and-support" onClick={toTop} className={styles.linkBtn}>
                    Help &amp; Support
                  </Link>
                </li>
              </ul>
            </div>

            <div className={styles.navCol}>
              <h2 className={styles.colTitle}>Legal</h2>
              <ul className={styles.linkList}>
                <li>
                  <Link to="/privacy-policy" onClick={toTop} className={styles.linkBtn}>
                    Privacy Policy
                  </Link>
                </li>
                <li>
                  <Link to="/terms-and-conditions" onClick={toTop} className={styles.linkBtn}>
                    Terms of Service
                  </Link>
                </li>
                <li>
                  <Link to="/community-guidelines" onClick={toTop} className={styles.linkBtn}>
                    Community Guidelines
                  </Link>
                </li>
                <li>
                  <Link to="/cookie-policy" onClick={toTop} className={styles.linkBtn}>
                    Cookie Policy
                  </Link>
                </li>
                <li>
                  <button
                    onClick={openPreferences}
                    className={styles.linkBtn}
                    aria-label="Manage cookie preferences"
                  >
                    Cookie Preferences
                  </button>
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Giant Bottom Wordmark Logo Banner */}
        <div className={styles.giantWordmarkWrapper}>
          <img src={wordmarkImg} alt="Meetifyy" className={styles.giantWordmarkImg} />
        </div>
      </div>
    </footer>
  );
}


