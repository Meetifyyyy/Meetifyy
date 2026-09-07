import LegalDocumentPage from './LegalDocumentPage';

/** The published Privacy Policy. See LegalDocumentPage — the text is in the database. */
export default function PrivacyPolicyPage() {
  return (
    <LegalDocumentPage
      documentType="PRIVACY_POLICY"
      badge="Legal & Transparency"
      fallbackTitle="Privacy Policy"
    />
  );
}
