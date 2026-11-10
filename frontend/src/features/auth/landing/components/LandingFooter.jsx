import { Link } from 'react-router-dom';
import { useCookieConsent } from '@shared/context/CookieConsentContext';
import '../landing.css';
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
      <div className={styles.inner}>
        <div className={styles.top}>
          <div className={styles.signoffCopy}>
            <p className={styles.signoff}>
              see you on <span className={styles.signoffSerif}>campus.</span>
            </p>
            <p className={styles.sub}>
              The social app for college life. Join 300+ students already
              finding their people.
            </p>
            <div className={styles.actions}>
              <Link to="/signup" className="lp-btn lp-btn--solid">Create account</Link>
              <Link to="/login" className="lp-btn">Log in</Link>
            </div>
          </div>

          <div className={styles.links}>
            <div>
              {/* h2: the only headings in the contentinfo landmark. */}
              <h2 className={styles.colTitle}>Company</h2>
              <ul className={styles.list}>
                <li><Link to="/about" onClick={toTop} className={styles.link}>About us</Link></li>
                <li><Link to="/help-and-support" onClick={toTop} className={styles.link}>Help &amp; support</Link></li>
                <li>
                  <a href="https://www.instagram.com/meetifyy.app" target="_blank" rel="noopener noreferrer" className={styles.link}>
                    Instagram
                  </a>
                </li>
                <li>
                  <a href="https://www.linkedin.com/company/meetifyy/" target="_blank" rel="noopener noreferrer" className={styles.link}>
                    LinkedIn
                  </a>
                </li>
              </ul>
            </div>

            <div>
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
          </div>
        </div>

        {/* The name, set as wide as the page. Decorative: the line below says it. */}
        <p className={styles.name} aria-hidden="true">
          meetif<span className={styles.nameAccent}>yy</span>
        </p>

        <div className={styles.bottom}>
          <p className={styles.legal}>© {new Date().getFullYear()} Meetifyy · Made for students, by students.</p>
          <button type="button" className={styles.toTop} onClick={toTop}>
            Back to top <span aria-hidden="true">↑</span>
          </button>
        </div>
      </div>
    </footer>
  );
}
