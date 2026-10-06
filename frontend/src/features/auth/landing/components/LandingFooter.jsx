import { Link } from 'react-router-dom';
import { useCookieConsent } from '@shared/context/CookieConsentContext';
import wordmarkImg from '@assets/images/meetifyy_wordmark.svg';
import stageLights from '../assets/stage-lights.webp';
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
        <div className={styles.card}>
          <div className={styles.cardText}>
            <p className={styles.signoff}>
              See you on <span className={styles.highlight}>campus</span>.
            </p>
            <p className={styles.cardSub}>
              Join 300+ verified students already finding their people.
            </p>
            <div className={styles.cardActions}>
              <Link to="/signup" className={styles.cta}>Create account</Link>
              <Link to="/login" className={styles.ctaGhost}>Log in</Link>
            </div>
          </div>
          <img
            className={styles.cardPhoto}
            src={stageLights}
            alt="Hands raised at a concert under blue stage lights"
            width="1000"
            height="800"
            loading="lazy"
            decoding="async"
          />
        </div>

        <div className={styles.columns}>
          <div className={styles.about}>
            <img src={wordmarkImg} alt="Meetifyy" className={styles.aboutWordmark} />
            <p className={styles.aboutText}>
              The campus social app for verified college students. Circles,
              plans and chats with the people around you.
            </p>
          </div>

          <div className={styles.col}>
            {/* h2: the only headings in the contentinfo landmark. */}
            <h2 className={styles.colTitle}>Company</h2>
            <ul className={styles.list}>
                <li><Link to="/about" onClick={toTop} className={styles.link}>About us</Link></li>
                <li><Link to="/help-and-support" onClick={toTop} className={styles.link}>Help &amp; support</Link></li>
            </ul>
          </div>

          <div className={styles.col}>
            <h2 className={styles.colTitle}>Legal</h2>
            <ul className={styles.list}>
                <li><Link to="/privacy-policy" onClick={toTop} className={styles.link}>Privacy policy</Link></li>
                <li><Link to="/terms-and-conditions" onClick={toTop} className={styles.link}>Terms of service</Link></li>
                <li><Link to="/community-guidelines" onClick={toTop} className={styles.link}>Community guidelines</Link></li>
                <li><Link to="/cookie-policy" onClick={toTop} className={styles.link}>Cookie policy</Link></li>
                <li>
                  <button type="button" onClick={openPreferences} className={styles.link}>
                    Cookie preferences
                  </button>
                </li>
            </ul>
          </div>

          <div className={styles.col}>
            <h2 className={styles.colTitle}>Follow us</h2>
            <div className={styles.socials}>
              <a
                href="https://www.instagram.com/meetifyy.in?igsi=YzVoZ3drN29id2tn"
                target="_blank"
                rel="noopener noreferrer"
                className={styles.social}
                aria-label="Instagram"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="2" width="20" height="20" rx="5" />
                  <circle cx="12" cy="12" r="4" />
                  <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
                </svg>
              </a>
              <a
                href="https://www.linkedin.com/company/meetifyy/"
                target="_blank"
                rel="noopener noreferrer"
                className={styles.social}
                aria-label="LinkedIn"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M16 8a6 6 0 016 6v7h-4v-7a2 2 0 00-2-2 2 2 0 00-2 2v7h-4v-7a6 6 0 016-6zM2 9h4v12H2z" />
                  <circle cx="4" cy="4" r="2" />
                </svg>
              </a>
            </div>
          </div>
        </div>

        <div className={styles.bottom}>
          <p className={styles.legal}>© {new Date().getFullYear()} Meetifyy</p>
          <p className={styles.legal}>Made for students, by students.</p>
        </div>

      </div>
    </footer>
  );
}
