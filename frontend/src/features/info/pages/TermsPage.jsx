import LegalDocumentPage from './LegalDocumentPage';

/** The Terms of Service: the current published version (see LegalDocumentPage). */
export default function TermsPage() {
  return (
    <LegalDocumentPage
      documentType="TERMS_OF_SERVICE"
      badge="Terms of Service"
      fallbackTitle="Terms of Service"
    />
  );
}
