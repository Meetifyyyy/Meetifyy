import { Link } from 'react-router-dom';
import { config, IS_MOBILE_BUILD } from '@config';
import { Mail } from '@shared/components/icons';
import { appVersionLabel } from '@shared/lib/appVersion';
import styles from './HelpHub.module.css';

/**
 * Policies and the support address. The app also shows its version, which is
 * worth quoting to support; on the website there is no version to speak of.
 */
export default function HelpFooter() {
  const supportEmail = config?.app?.supportEmail;
  return (
    <footer className={styles.footer}>
      {supportEmail && (
        <a className={styles.footerMail} href={`mailto:${supportEmail}`}>
          <Mail size={15} aria-hidden="true" />
          {supportEmail}
        </a>
      )}
      <nav className={styles.footerLinks} aria-label="Policies">
        <Link to="/community-guidelines">Community guidelines</Link>
        <span className={styles.footerDot} aria-hidden="true">·</span>
        <Link to="/privacy-policy">Privacy</Link>
        <span className={styles.footerDot} aria-hidden="true">·</span>
        <Link to="/terms-and-conditions">Terms</Link>
      </nav>
      {IS_MOBILE_BUILD && <p className={styles.version}>{appVersionLabel()}</p>}
    </footer>
  );
}
