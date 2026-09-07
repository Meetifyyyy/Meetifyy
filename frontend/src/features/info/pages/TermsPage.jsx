import LegalDocumentPage from './LegalDocumentPage';

/**
 * The published Terms of Service.
 *
 * The text lives in the database and is edited in the Admin Portal; this file
 * is only the route. It used to carry the whole document as JSX, which meant a
 * wording change was a code deploy and no record existed of which version a
 * user had agreed to.
 */
export default function TermsPage() {
  return (
    <LegalDocumentPage
      documentType="TERMS_OF_SERVICE"
      badge="Terms of Service"
      fallbackTitle="Terms of Service"
    />
  );
}
