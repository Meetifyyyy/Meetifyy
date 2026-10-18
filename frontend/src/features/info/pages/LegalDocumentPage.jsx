import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import StaticDocLayout from './StaticDocLayout';
import styles from './StaticDocLayout.module.css';
import { LEGAL_DOCUMENTS } from './legalDocuments';
import { legalApi } from '@shared/api/apiClient';
import {
  hardenExternalLinks,
  makeInternalLinkHandler,
  wrapTablesForScroll,
} from '@shared/utils/legalHtmlLinks';

/**
 * Last API answers, kept for the life of the tab so a back press onto a legal
 * page paints the finished document on its first frame. `load()` still
 * refreshes on every mount.
 */
const documentCache = new Map();
const historyCache = new Map();

/**
 * A date for display. A bare "2026-08-27" (the static fallback) is read as a
 * local calendar day so no timezone can shift it; anything else is an ISO
 * timestamp from the API.
 */
export function formatLegalDate(value) {
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** The bundled copy of a document, shaped like the API's answer. */
function staticDocument(documentType) {
  const doc = LEGAL_DOCUMENTS[documentType];
  return doc ? { ...doc, source: 'static' } : null;
}

/**
 * A public legal page.
 *
 * The text is the CURRENT published version from `/api/legal/documents/:type`
 * (admin-managed). The bundled copy in legalDocuments.js is a fallback: it is
 * painted while the first request is in flight and kept if the API cannot be
 * reached, so the page never shows an error where it could show the Terms.
 *
 * `?version=N` shows an older published version read-only, under a banner that
 * says so. The "Previous versions" list at the bottom links to those.
 *
 * Every endpoint used here is unauthenticated, so this works signed out and for
 * a user held behind the update screen.
 */
export default function LegalDocumentPage({
  documentType,
  badge,
  fallbackTitle,
  children,
}) {
  const [searchParams] = useSearchParams();
  const requestedVersion = Number.parseInt(searchParams.get('version') ?? '', 10);

  const [doc, setDoc] = useState(
    () => documentCache.get(documentType) ?? staticDocument(documentType),
  );
  const [history, setHistory] = useState(() => historyCache.get(documentType) ?? []);
  const [older, setOlder] = useState({ state: 'idle', doc: null });
  const loadIdRef = useRef(0);
  const contentRef = useRef(null);
  const navigate = useNavigate();

  const handleContentClick = useMemo(
    () => makeInternalLinkHandler(navigate),
    [navigate],
  );

  const load = useCallback(async () => {
    const id = ++loadIdRef.current;
    const [current, versions] = await Promise.allSettled([
      legalApi.getDocument(documentType),
      legalApi.listVersions(documentType),
    ]);
    if (id !== loadIdRef.current) return;
    if (current.status === 'fulfilled' && current.value?.content) {
      const next = { ...current.value, source: 'api' };
      documentCache.set(documentType, next);
      setDoc(next);
    }
    // On failure the bundled copy (or the last good answer) stays on screen.
    if (versions.status === 'fulfilled' && Array.isArray(versions.value)) {
      historyCache.set(documentType, versions.value);
      setHistory(versions.value);
    }
  }, [documentType]);

  useEffect(() => {
    setDoc(documentCache.get(documentType) ?? staticDocument(documentType));
    setHistory(historyCache.get(documentType) ?? []);
    load();
  }, [documentType, load]);

  // The live version's number, once the server has said what it is. The
  // bundled fallback is not a version anyone published, so it never counts.
  const currentVersionNumber =
    doc?.source === 'api' && Number.isInteger(doc.versionNumber)
      ? doc.versionNumber
      : history.find((v) => v.isCurrent)?.versionNumber;

  // A specific version, when one is asked for and it is not the live one.
  const viewingOlder =
    Number.isInteger(requestedVersion) &&
    requestedVersion > 0 &&
    currentVersionNumber !== requestedVersion;

  useEffect(() => {
    if (!viewingOlder) {
      setOlder({ state: 'idle', doc: null });
      return undefined;
    }
    let cancelled = false;
    setOlder({ state: 'loading', doc: null });
    legalApi
      .getVersion(documentType, requestedVersion)
      .then((res) => {
        if (cancelled) return;
        if (res?.isCurrent) {
          // Asked for the live version by number: just show the page.
          navigate({ search: '' }, { replace: true });
          return;
        }
        setOlder({ state: 'ready', doc: res });
      })
      .catch(() => {
        if (!cancelled) setOlder({ state: 'error', doc: null });
      });
    return () => {
      cancelled = true;
    };
  }, [viewingOlder, documentType, requestedVersion, navigate]);

  // Moving between versions is a new page to the reader: start at the top.
  const firstRenderRef = useRef(true);
  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [requestedVersion]);

  const shown = viewingOlder ? older.doc : doc;

  useEffect(() => {
    hardenExternalLinks(contentRef.current);
    wrapTablesForScroll(contentRef.current);
  }, [shown?.content]);

  // Published or archived versions other than the one on screen.
  const previous = history.filter((v) =>
    viewingOlder ? v.versionNumber !== requestedVersion : !v.isCurrent,
  );

  const lastUpdated = shown?.lastUpdatedAt ?? shown?.publishedAt;

  // "Older version" is a claim, so it waits for evidence: the version itself
  // came back as not current, or the server has named a different live one.
  // Until then (only the static fallback on screen, N possibly the current
  // version) the page shows its loading state without the banner.
  const showOlderBanner =
    viewingOlder &&
    ((older.state === 'ready' && older.doc && !older.doc.isCurrent) ||
      (currentVersionNumber !== undefined && older.state !== 'loading'));

  return (
    <StaticDocLayout
      badge={badge}
      title={shown?.title || doc?.title || fallbackTitle}
      subtitle={shown?.subtitle || (viewingOlder ? undefined : doc?.subtitle) || undefined}
      effectiveDate={formatLegalDate(lastUpdated)}
      effectiveFrom={formatLegalDate(shown?.effectiveAt)}
      noHeroCard
      leftAlign
    >
      {showOlderBanner && (
        <div className={styles.olderBanner} role="status">
          <strong>This is an older version.</strong>{' '}
          {older.doc
            ? `Version ${older.doc.versionNumber}${
                older.doc.effectiveAt
                  ? `, effective ${formatLegalDate(older.doc.effectiveAt)}`
                  : ''
              }. It is no longer in effect.`
            : 'It is no longer in effect.'}{' '}
          <Link to={{ search: '' }} className={styles.olderBannerLink}>
            View the current version
          </Link>
        </div>
      )}

      {viewingOlder && older.state === 'loading' && (
        <div className={styles.docState} aria-busy="true" aria-label="Loading this version">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className={styles.docSkeletonLine}
              style={{ maxWidth: i % 3 === 2 ? '22rem' : '34rem' }}
            />
          ))}
        </div>
      )}

      {viewingOlder && older.state === 'error' && (
        <div className={styles.docState} role="alert">
          <h2 className={styles.docStateTitle}>We could not load that version</h2>
          <p>It may not exist, or the connection dropped. The current version is always available.</p>
        </div>
      )}

      {shown?.content && (
        <div
          ref={contentRef}
          className={styles.docHtml}
          onClick={handleContentClick}
          // Sanitized on write by the admin save path (sanitizeArticleHtml), or
          // the bundled static copy, which was taken from such a version.
          dangerouslySetInnerHTML={{ __html: shown.content }}
        />
      )}

      {/* Page chrome that is app behaviour rather than document text, e.g.
          the Cookie Policy's storage-preferences control. */}
      {!viewingOlder && children}

      {previous.length > 0 && (
        <section className={styles.versionsSection} aria-labelledby="legal-previous-versions">
          <h2 id="legal-previous-versions" className={styles.versionsTitle}>
            Previous versions
          </h2>
          <ul className={styles.versionList}>
            {viewingOlder && history.some((v) => v.isCurrent) && (
              <li>
                <Link to={{ search: '' }} className={styles.versionItem}>
                  <span className={styles.versionHead}>
                    Current version
                    <span className={styles.versionBadge}>In effect</span>
                  </span>
                </Link>
              </li>
            )}
            {previous
              .filter((v) => !v.isCurrent)
              .map((v) => (
                <li key={v.versionId}>
                  <Link
                    to={{ search: `?version=${v.versionNumber}` }}
                    className={styles.versionItem}
                  >
                    <span className={styles.versionHead}>
                      Version {v.versionNumber}
                      {v.effectiveAt && (
                        <span className={styles.versionDate}>
                          Effective {formatLegalDate(v.effectiveAt)}
                        </span>
                      )}
                    </span>
                    {v.changeSummary && (
                      <span className={styles.versionSummary}>{v.changeSummary}</span>
                    )}
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      )}
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
