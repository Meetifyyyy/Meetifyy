import { Link } from 'react-router-dom';
import { config } from '@config';
import { appVersionLabel } from '@shared/lib/appVersion';
import styles from './HelpHub.module.css';

/** Policies, the support address, and which build this is (quote it to support). */
export default function HelpFooter() {
  const supportEmail = config?.app?.supportEmail;
  return (
    <footer className={styles.footer}>
      <nav className={styles.footerLinks} aria-label="Policies">
        <Link to="/community-guidelines">Community guidelines</Link>
        <Link to="/privacy-policy">Privacy</Link>
        <Link to="/terms-and-conditions">Terms</Link>
      </nav>
      {supportEmail && (
        <p>
          Email us at <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
        </p>
      )}
      <p className={styles.version}>{appVersionLabel()}</p>
    </footer>
  );
}
