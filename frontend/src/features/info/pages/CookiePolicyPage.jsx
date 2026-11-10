import LegalDocumentPage from './LegalDocumentPage';
import styles from './StaticDocLayout.module.css';
import { useCookieConsent } from '@shared/context/CookieConsentContext';

/**
 * The published Cookie Policy.
 *
 * The one legal page with a control attached: the storage-preferences panel.
 * That control is app behaviour, not document text, so it is rendered here
 * rather than stored in the document body — an admin editing a policy must not
 * be able to add or remove something that changes how the app behaves.
 */
export default function CookiePolicyPage() {
  const { openPreferences } = useCookieConsent();

  return (
    <LegalDocumentPage
      documentType="COOKIE_POLICY"
      badge="Privacy & Security"
      fallbackTitle="Cookie Policy"
    >
      <div className={`${styles.docHtml} ${styles.docExtra}`}>
        <h2>Your storage preferences</h2>
        <p>
          Every storage category Meetifyy uses is summarised in the panel below,
          in the same detail as this page describes.
        </p>
        <button
          type="button"
          onClick={openPreferences}
          className={styles.docButton}
          aria-label="Open storage preferences detail"
        >
          View Storage Details
        </button>
      </div>
    </LegalDocumentPage>
  );
}
