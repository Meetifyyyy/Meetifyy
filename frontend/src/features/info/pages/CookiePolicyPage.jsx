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
      <div className={styles.docHtml} style={{ marginTop: '2rem' }}>
        <h2>Your storage preferences</h2>
        <p>
          Every storage category Meetifyy uses is summarised in the panel below,
          in the same detail as this page describes.
        </p>
        <button
          type="button"
          onClick={openPreferences}
          style={{
            marginTop: '1rem',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            height: '38px',
            padding: '0 1.25rem',
            borderRadius: '999px',
            border: '1px solid var(--color-border-dark)',
            background: 'var(--color-bg-soft)',
            color: 'var(--color-text-main)',
            fontSize: '0.825rem',
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
          aria-label="Open storage preferences detail"
        >
          View Storage Details
        </button>
      </div>
    </LegalDocumentPage>
  );
}
