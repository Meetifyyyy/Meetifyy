import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest } from '../api/apiClient';
import { LoadingState } from '../components/LoadingState';
import { Eye, FileText } from '../components/icons';
import { MediaViewer } from '../components/MediaViewer';

/**
 * What the API returns for one document. `url` is a five-minute signed link to a
 * private object; `signError` is true only when the object exists and a link for
 * it could not be produced (as opposed to nothing ever having been uploaded).
 */
export interface ReviewerDocument {
  url: string | null;
  signError?: boolean;
}

interface DocumentsResponse {
  selfie: ReviewerDocument;
  idCard: ReviewerDocument;
}

interface Props {
  requestId: string;
  kind: 'selfie' | 'idCard';
  label: string;
  alt: string;
  emptyText: string;
  /** `null`/absent when no document was uploaded. */
  media: ReviewerDocument | null | undefined;
  /** When `media.url` was issued (ms since epoch), e.g. the list query's `dataUpdatedAt`. */
  issuedAt: number;
}

/** The server signs for 300s; past this, open through a fresh link instead. */
const FRESH_FOR_MS = 45_000;

/**
 * One verification document: a preview and an in-page viewer that survive the
 * signed URL expiring.
 *
 * The URL is valid for five minutes and the review page can stay open far
 * longer, so a preview that fails (expired, slow, or a storage hiccup) is not
 * the end: the first failure quietly asks the API for a fresh link for just this
 * request and tries again; a second one shows a labelled state with a Retry.
 * Opening the full-size image from a stale page fetches a fresh link first.
 * Nothing here ever makes the object public — the link is re-signed for the
 * reviewer each time.
 */
export const VerificationDocument: React.FC<Props> = ({
  requestId,
  kind,
  label,
  alt,
  emptyText,
  media,
  issuedAt,
}) => {
  // A link fetched here replaces the one from the list until the list itself
  // delivers a different one.
  const [viewerOpen, setViewerOpen] = useState(false);
  const [fresh, setFresh] = useState<{ doc: ReviewerDocument; at: number } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const autoRetried = useRef(false);
  const alive = useRef(true);
  const token = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const listUrl = media?.url ?? null;
  useEffect(() => {
    setFresh(null);
    setFailed(false);
    setLoaded(false);
    autoRetried.current = false;
  }, [listUrl, requestId]);

  const doc: ReviewerDocument | null = fresh ? fresh.doc : (media ?? null);
  const docIssuedAt = fresh ? fresh.at : issuedAt;

  /** Asks for new links for this request; resolves to this document's, or null. */
  const fetchFresh = useCallback(async (): Promise<ReviewerDocument | null> => {
    const mine = ++token.current;
    setRefreshing(true);
    try {
      const res = await apiRequest<DocumentsResponse>(
        `/admin/verification/requests/${encodeURIComponent(requestId)}/documents`,
      );
      const next = res?.[kind] ?? null;
      if (alive.current && mine === token.current && next) {
        setFresh({ doc: next, at: Date.now() });
        setFailed(false);
        setLoaded(false);
        setAttempt((n) => n + 1);
      }
      return next;
    } catch {
      return null;
    } finally {
      if (alive.current && mine === token.current) setRefreshing(false);
    }
  }, [requestId, kind]);

  const handleImageError = () => {
    if (!autoRetried.current) {
      autoRetried.current = true;
      void fetchFresh().then((next) => {
        if (alive.current && !next?.url) setFailed(true);
      });
      return;
    }
    setFailed(true);
  };

  const retry = () => {
    autoRetried.current = true; // a manual retry never loops on its own
    void fetchFresh().then((next) => {
      if (alive.current && !next?.url) setFailed(true);
    });
  };

  /** The same freshness policy now opens the full-size image in this page. */
  const open = () => {
    setViewerOpen(true);
    if (doc?.url && Date.now() - docIssuedAt < FRESH_FOR_MS) return;
    void fetchFresh().then((next) => {
      if (alive.current && !next?.url) setFailed(true);
    });
  };

  const showError = failed || Boolean(doc?.signError && !doc.url);
  const url = doc?.url ?? null;

  let body: React.ReactNode;
  if (!doc) {
    body = <div className="verification-media-empty"><FileText size={24} /><span>{emptyText}</span></div>;
  } else if (showError) {
    body = (
      <div role="alert" className="verification-document-message">
        <span>
          {doc.signError && !failed
            ? `We couldn't prepare this ${label.toLowerCase()} for viewing.`
            : `This ${label.toLowerCase()} couldn't be loaded. The link may have expired.`}
        </span>
        <button type="button" className="btn-secondary" onClick={retry} disabled={refreshing}>
          {refreshing ? 'Retrying…' : 'Retry'}
        </button>
      </div>
    );
  } else if (url) {
    body = (
      <>
        <button type="button" className="verification-preview-button" onClick={open} aria-label={`View ${label.toLowerCase()}`}>
          <img
            key={`${url}-${attempt}`}
            src={url}
            alt={alt}
            loading="lazy"
            decoding="async"
            onLoad={() => setLoaded(true)}
            onError={handleImageError}
            style={loaded ? undefined : { opacity: 0 }}
          />
        </button>
        {!loaded && (
          <div className="verification-document-loading"><LoadingState label={refreshing ? 'Refreshing link…' : 'Loading document…'} compact /></div>
        )}
      </>
    );
  } else {
    body = <div className="verification-media-empty"><FileText size={24} /><span>{emptyText}</span></div>;
  }

  return (
    <div className="verification-media-card">
      <div className="verification-media-header">
        <span className="verification-media-label">{label}</span>
        {url && !showError && (
          <button type="button" className="verification-media-ext-link" title="View full resolution" aria-label={`View full resolution ${label.toLowerCase()}`} onClick={open}>
            <Eye size={14} />
            <span>View</span>
          </button>
        )}
      </div>
      <div className="verification-media-frame">{body}</div>
      {viewerOpen && (
        <MediaViewer title={label} alt={alt} src={showError || refreshing ? null : url} revision={attempt}
          fallback={refreshing ? <div role="status">Refreshing link…</div> : body}
          onClose={() => setViewerOpen(false)} onImageError={handleImageError} />
      )}
    </div>
  );
};

export default VerificationDocument;
