import { useNavigate } from 'react-router-dom';
import { useCookieConsent } from '@shared/context/CookieConsentContext';
import logoImg from '@assets/images/meetify_logo.webp';
import wordmarkImg from '@assets/images/meetifyy_wordmark.svg';
import styles from './LandingFooter.module.css';

export default function LandingFooter() {
  const navigate = useNavigate();
  const { openPreferences } = useCookieConsent();

  const handleNav = (path) => {
    navigate(path);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <footer id="about" className={styles.footer} role="contentinfo">
      <div className={styles.container}>
        {/* Main Footer Grid */}
        <div className={styles.mainGrid}>
          {/* Left Column: Brand Icon, Social Links */}
          <div className={styles.leftCol}>
            <button
              onClick={() => handleNav('/')}
              className={styles.logoBtn}
              aria-label="Meetifyy Home"
            >
              <img src={logoImg} alt="Meetifyy" className={styles.logoImg} />
            </button>

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
              <h4 className={styles.colTitle}>Company</h4>
              <ul className={styles.linkList}>
                <li>
                  <button onClick={() => handleNav('/about')} className={styles.linkBtn}>
                    About Us
                  </button>
                </li>
                <li>
                  <button onClick={() => handleNav('/help-and-support')} className={styles.linkBtn}>
                    Help &amp; Support
                  </button>
                </li>
              </ul>
            </div>

            <div className={styles.navCol}>
              <h4 className={styles.colTitle}>Legal</h4>
              <ul className={styles.linkList}>
                <li>
                  <button onClick={() => handleNav('/privacy-policy')} className={styles.linkBtn}>
                    Privacy Policy
                  </button>
                </li>
                <li>
                  <button onClick={() => handleNav('/terms-and-conditions')} className={styles.linkBtn}>
                    Terms of Service
                  </button>
                </li>
                <li>
                  <button onClick={() => handleNav('/community-guidelines')} className={styles.linkBtn}>
                    Community Guidelines
                  </button>
                </li>
                <li>
                  <button onClick={() => handleNav('/cookie-policy')} className={styles.linkBtn}>
                    Cookie Policy
                  </button>
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


