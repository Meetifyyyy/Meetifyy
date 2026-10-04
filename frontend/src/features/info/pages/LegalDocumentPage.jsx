import { useEffect, useMemo, useRef } from 'react';
import PropTypes from 'prop-types';
import StaticDocLayout from './StaticDocLayout';
import styles from './StaticDocLayout.module.css';
import { useNavigate } from 'react-router-dom';
import { LEGAL_DOCUMENTS } from './legalDocuments';
import {
  hardenExternalLinks,
  makeInternalLinkHandler,
  wrapTablesForScroll,
} from '@shared/utils/legalHtmlLinks';

/** "2026-08-27" as a local calendar date, so no timezone can shift the day. */
function formatDate(isoDay) {
  if (!isoDay) return undefined;
  const [y, m, d] = isoDay.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * A public legal page. The text is static site content (see legalDocuments.js);
 * it is no longer fetched, so there is no loading or error state to show.
 */
export default function LegalDocumentPage({
  documentType,
  badge,
  fallbackTitle,
  children,
}) {
  const doc = LEGAL_DOCUMENTS[documentType];
  const contentRef = useRef(null);
  const navigate = useNavigate();

  // Link behaviour for the injected body: internal links navigate in the SPA,
  // external ones open in a new tab with noopener. See legalHtmlLinks.
  const handleContentClick = useMemo(
    () => makeInternalLinkHandler(navigate),
    [navigate],
  );

  useEffect(() => {
    hardenExternalLinks(contentRef.current);
    wrapTablesForScroll(contentRef.current);
  }, [documentType]);

  return (
    <StaticDocLayout
      badge={badge}
      title={doc?.title || fallbackTitle}
      subtitle={doc?.subtitle || undefined}
      effectiveDate={formatDate(doc?.lastUpdatedAt)}
      effectiveFrom={formatDate(doc?.effectiveAt)}
      noHeroCard
      leftAlign
    >
      {/* Trusted, already-sanitized static content (legalDocuments.js). */}
      <div
        ref={contentRef}
        className={styles.docHtml}
        onClick={handleContentClick}
        dangerouslySetInnerHTML={{ __html: doc.content }}
      />
      {/* Page chrome that is app behaviour rather than document text, e.g.
          the Cookie Policy's storage-preferences control. */}
      {children}
    </StaticDocLayout>
  );
}

LegalDocumentPage.propTypes = {
  documentType: PropTypes.oneOf([
    'TERMS_OF_SERVICE',
    'PRIVACY_POLICY',
    'COOKIE_POLICY',
    'COMMUNITY_GUIDELINES',
  ]).isRequired,
  badge: PropTypes.string,
  fallbackTitle: PropTypes.string.isRequired,
  children: PropTypes.node,
};
