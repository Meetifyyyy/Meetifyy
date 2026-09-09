import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import StaticDocLayout from './StaticDocLayout';
import styles from './StaticDocLayout.module.css';
import { useNavigate } from 'react-router-dom';
import { legalApi } from '@shared/api/apiClient';
import {
  hardenExternalLinks,
  makeInternalLinkHandler,
  wrapTablesForScroll,
} from '@shared/utils/legalHtmlLinks';

/**
 * A public legal page, rendered from the currently published version in the
 * database.
 *
 * All four documents — Terms, Privacy Policy, Cookie Policy and Community
 * Guidelines — go through this one component. The text used to be hand-written
 * JSX in four files, which meant a policy change was a code deploy and nothing
 * recorded which words a user had agreed to. It is now admin-managed, so
 * hard-coding a copy back into the frontend would immediately reintroduce the
 * problem this feature exists to solve: two sources of truth, and the stale one
 * on screen.
 *
 * The endpoint is unauthenticated, so this works for a signed-out visitor and
 * for a signed-in user who is blocked behind the consent gate — the one flow in
 * which every other endpoint refuses. That is deliberate: reading the document
 * you are being asked to accept must never require having accepted it.
 */
export default function LegalDocumentPage({
  documentType,
  badge,
  fallbackTitle,
  children,
}) {
  const [doc, setDoc] = useState(null);
  const [loadState, setLoadState] = useState('loading'); // loading | ready | error
  const loadIdRef = useRef(0);
  const contentRef = useRef(null);
  const navigate = useNavigate();

  /**
   * Link behaviour for the injected document body — see legalHtmlLinks.
   *
   * The seeded documents predate the sanitizer's link rule, so their external
   * anchors carry no `rel`/`target` at all; and an internal cross-reference
   * inside injected HTML would otherwise full-page-reload the SPA.
   */
  const handleContentClick = useMemo(
    () => makeInternalLinkHandler(navigate),
    [navigate],
  );

  useEffect(() => {
    if (loadState !== 'ready') return;
    hardenExternalLinks(contentRef.current);
    wrapTablesForScroll(contentRef.current);
  }, [loadState, doc?.content]);

  /**
   * A load-id sequence rather than an AbortController, which is the pattern
   * HelpSupportPage settled on for the same reason.
   *
   * `apiClient` de-duplicates concurrent GETs by URL, so an aborted request
   * hands its rejection to every other caller waiting on the same promise.
   * Under React's double-invoked effects that meant the second mount received
   * the first mount's AbortError, treated it as "someone else cancelled" and
   * returned without setting anything — leaving the page on its skeleton
   * indefinitely. Superseded loads are ignored here; the newest one always
   * reaches a terminal state.
   */
  const load = useCallback(async () => {
    const id = ++loadIdRef.current;
    setLoadState('loading');
    try {
      const res = await legalApi.getDocument(documentType);
      if (id !== loadIdRef.current) return;
      setDoc(res);
      setLoadState('ready');
    } catch {
      if (id !== loadIdRef.current) return;
      setLoadState('error');
    }
  }, [documentType]);

  useEffect(() => {
    load();
  }, [load]);

  const formatDate = (value) =>
    value
      ? new Date(value).toLocaleDateString(undefined, {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })
      : null;

  return (
    <StaticDocLayout
      badge={badge}
      title={doc?.title || fallbackTitle}
      subtitle={doc?.subtitle || undefined}
      effectiveDate={formatDate(doc?.lastUpdatedAt) || undefined}
      effectiveFrom={formatDate(doc?.effectiveAt) || undefined}
      noHeroCard
      leftAlign
    >
      {loadState === 'loading' && (
        <div
          className={styles.docState}
          aria-busy="true"
          aria-live="polite"
          aria-label="Loading the document"
        >
          {/* Skeleton rather than a spinner: the shape of what is coming is a
              page of text, and a centred spinner on a document reads as an
              error to a reader who arrived from a footer link. */}
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className={styles.docSkeletonLine}
              style={{ maxWidth: i % 3 === 2 ? '22rem' : '34rem' }}
            />
          ))}
        </div>
      )}

      {loadState === 'error' && (
        <div className={styles.docState} role="alert">
          <h2 className={styles.docStateTitle}>We could not load this page</h2>
          <p>
            Something went wrong fetching the current version. Please check your
            connection and try again.
          </p>
          <button
            type="button"
            className={styles.docRetryBtn}
            onClick={load}
          >
            Try again
          </button>
        </div>
      )}

      {loadState === 'ready' && !doc?.content && (
        <div className={styles.docState}>
          <h2 className={styles.docStateTitle}>Nothing published yet</h2>
          <p>
            This document has not been published. Please check back shortly.
          </p>
        </div>
      )}

      {loadState === 'ready' && doc?.content && (
        <>
          {/* Sanitized on write by the admin save path — the same sanitizer the
              help centre uses — so no unsanitized copy of this exists anywhere
              for some other consumer to render. */}
          {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions,
              jsx-a11y/click-events-have-key-events -- delegation for anchors
              that are already keyboard-operable in their own right. */}
          <div
            ref={contentRef}
            className={styles.docHtml}
            onClick={handleContentClick}
            dangerouslySetInnerHTML={{ __html: doc.content }}
          />
          {/* Page chrome that is app behaviour rather than document text, e.g.
              the Cookie Policy's storage-preferences control. Kept outside the
              stored content on purpose: an admin editing a policy must not be
              able to add or remove a control that changes the app. */}
          {children}
        </>
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
