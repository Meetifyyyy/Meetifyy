import LegalDocumentPage from './LegalDocumentPage';

/** The Privacy Policy: the current published version (see LegalDocumentPage). */
export default function PrivacyPolicyPage() {
  return (
    <LegalDocumentPage
      documentType="PRIVACY_POLICY"
      badge="Legal & Transparency"
      fallbackTitle="Privacy Policy"
    />
  );
}
