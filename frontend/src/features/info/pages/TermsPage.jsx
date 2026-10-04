import LegalDocumentPage from './LegalDocumentPage';

/** The Terms of Service. The text is in legalDocuments.js. */
export default function TermsPage() {
  return (
    <LegalDocumentPage
      documentType="TERMS_OF_SERVICE"
      badge="Terms of Service"
      fallbackTitle="Terms of Service"
    />
  );
}
