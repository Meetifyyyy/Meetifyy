import LegalDocumentPage from './LegalDocumentPage';

/** The published Community Guidelines. See LegalDocumentPage. */
export default function CommunityGuidelinesPage() {
  return (
    <LegalDocumentPage
      documentType="COMMUNITY_GUIDELINES"
      badge="Safety & Culture"
      fallbackTitle="Community Guidelines"
    />
  );
}
