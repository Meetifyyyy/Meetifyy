import LegalDocumentPage from './LegalDocumentPage';

/** The published Privacy Policy. The text is in legalDocuments.js. */
export default function PrivacyPolicyPage() {
  return (
    <LegalDocumentPage
      documentType="PRIVACY_POLICY"
      badge="Legal & Transparency"
      fallbackTitle="Privacy Policy"
    />
  );
}
