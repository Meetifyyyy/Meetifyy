import { useNavigate } from 'react-router-dom';
import logo from '@assets/images/meetify logo.png';
import styles from './LandingFooter.module.css';

export default function LandingFooter() {
  const navigate = useNavigate();

  const handleLogoClick = () => {
    navigate('/');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleNav = (path) => {
    navigate(path);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <footer id="about" className={styles.footer} role="contentinfo">
      <div className={styles.container}>
        {/* Top Grid */}
        <div className={styles.grid}>
          <div className={styles.brandCol}>
            <button
              onClick={handleLogoClick}
              className={`${styles.brand} group`}
            >
              <img src={logo} alt="Meetifyy" className={styles.logoImg} />
              <span className={`${styles.brandName} landing-font-display`}>
                Meetifyy
              </span>
            </button>
            <p className={styles.tagline}>
              The platform where campus life actually happens. Built for students, by students, at every university in India.
            </p>
          </div>

          <div>
            <p className={styles.colTitle}>Company</p>
            <ul className={styles.linkList} role="list">
              <li>
                <button
                  onClick={() => handleNav('/about')}
                  className={styles.linkButton}
                >
                  About Us
                </button>
              </li>
              <li>
                <button
                  onClick={() => handleNav('/contact')}
                  className={styles.linkButton}
                >
                  Contact
                </button>
              </li>
            </ul>
          </div>

          <div>
            <p className={styles.colTitle}>Legal</p>
            <ul className={styles.linkList} role="list">
              <li>
                <button
                  onClick={() => handleNav('/privacy-policy')}
                  className={styles.linkButton}
                >
                  Privacy Policy
                </button>
              </li>
              <li>
                <button
                  onClick={() => handleNav('/terms-and-conditions')}
                  className={styles.linkButton}
                >
                  Terms of Service
                </button>
              </li>
              <li>
                <button
                  onClick={() => handleNav('/community-guidelines')}
                  className={styles.linkButton}
                >
                  Community Guidelines
                </button>
              </li>
              <li>
                <button
                  onClick={() => handleNav('/cookie-policy')}
                  className={styles.linkButton}
                >
                  Cookie Policy
                </button>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className={styles.bottom}>
          <p className={styles.copy}>
            © 2026 Meetifyy. All rights reserved.
          </p>

          <div className={styles.socials} aria-label="Social media links">
            {/* Twitter */}
            <a
              href="#"
              className={styles.socialLink}
              aria-label="Twitter"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </a>
            {/* Instagram */}
            <a
              href="#"
              className={styles.socialLink}
              aria-label="Instagram"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="2" y="2" width="20" height="20" rx="5" />
                <circle cx="12" cy="12" r="4" />
                <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
              </svg>
            </a>
            {/* LinkedIn */}
            <a
              href="#"
              className={styles.socialLink}
              aria-label="LinkedIn"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M16 8a6 6 0 016 6v7h-4v-7a2 2 0 00-2-2 2 2 0 00-2 2v7h-4v-7a6 6 0 016-6zM2 9h4v12H2z" />
                <circle cx="4" cy="4" r="2" />
              </svg>
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
