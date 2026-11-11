import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { legalApi, type LegalDocumentSummary } from './legal/legalApi';
import { formatDate, publicUrl } from './legal/legalFormat';
import { LoadingState } from '../components/LoadingState';
import { AcceptanceBar, LegalError } from './legal/LegalBits';
import { NotifyDialog } from './legal/NotifyDialog';
import { ArrowRight, BookOpen, ExternalLink, Megaphone } from '../components/icons';
import './legal/legal.css';

/**
 * Legal — the Terms, Privacy Policy, Cookie Policy and Community Guidelines.
 *
 * Draft → preview → publish, with or without the update screen. A published
 * version is never changed in place: it is the exact wording some user's
 * acceptance points at.
 */
export const LegalPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [notifying, setNotifying] = useState(false);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['adminLegalDocuments'],
    queryFn: legalApi.listDocuments,
  });
  const documents = data ?? [];

  return (
    <div className="admin-page legal-page">
      <div className="page-header">
        <div>
          <h2 className="page-title">Legal documents</h2>
          <p className="page-subtitle">
            Manage published policies, prepare updates, and review version history.
          </p>
        </div>
        <button
          type="button"
          className="btn-secondary legal-notify-btn"
          onClick={() => setNotifying(true)}
          disabled={!documents.some((doc) => doc.published)}
        >
          <Megaphone size={15} />
          <span>Notify users</span>
        </button>
      </div>

      <dl className="legal-summary" aria-label="Legal document totals" aria-busy={isLoading}>
        <div className="legal-stat tone-blue"><dt>Live documents</dt><dd>{data ? documents.filter((doc) => doc.published).length : '—'}</dd></div>
        <div className="legal-stat tone-violet"><dt>Draft updates</dt><dd>{data ? documents.filter((doc) => doc.draft).length : '—'}</dd></div>
        <div className="legal-stat tone-green"><dt>Published versions</dt><dd>{data ? documents.reduce((total, doc) => total + doc.publishedVersionCount, 0).toLocaleString() : '—'}</dd></div>
      </dl>
      {isLoading && !data ? <LoadingState label="Loading legal documents…" /> : isError && !data ? <LegalError message="The documents could not be loaded." retry={() => void refetch()} /> : documents.length === 0 ? <div className="legal-empty"><BookOpen size={32} /><h3>No legal documents</h3><p>Documents will appear here once they are available.</p></div> : (
        <div className="legal-grid">
          {documents.map((doc) => (
            <DocumentCard key={doc.documentType} doc={doc} />
          ))}
        </div>
      )}

      {notifying && (
        <NotifyDialog
          documents={documents}
          onClose={() => setNotifying(false)}
          onDone={() => {
            setNotifying(false);
            void queryClient.invalidateQueries({ queryKey: ['adminLegalDocuments'] });
            void queryClient.invalidateQueries({ queryKey: ['adminLegalDocument'] });
          }}
        />
      )}
    </div>
  );
};

const DocumentCard: React.FC<{ doc: LegalDocumentSummary }> = ({ doc }) => {
  const published = doc.published;
  return (
    <article className="glass-panel legal-card">
      <header className="legal-card-head">
        <div className="legal-card-heading">
          <span className="legal-icon-tile"><BookOpen size={19} /></span>
          <h3 className="legal-card-title">{doc.label}</h3>
        </div>
        <div className="legal-badges">
          {published ? (
            <span className="badge badge-success">Live · v{published.versionNumber}</span>
          ) : (
            <span className="badge badge-danger">Never published</span>
          )}
          {doc.draft && <span className="badge badge-warning">Draft · v{doc.draft.versionNumber}</span>}
          {published?.requiresAcknowledgement && <span className="badge badge-info">Notified</span>}
        </div>
      </header>

      <div className="legal-card-body">
        <dl className="legal-meta">
          <div>
            <dt>Effective</dt>
            <dd>{formatDate(published?.effectiveAt)}</dd>
          </div>
          <div>
            <dt>Last published</dt>
            <dd>{formatDate(published?.publishedAt)}</dd>
          </div>
          <div>
            <dt>Last notified</dt>
            <dd>{doc.lastNotifiedAt ? formatDate(doc.lastNotifiedAt) : 'Never'}</dd>
          </div>
        </dl>

        {published?.requiresAcknowledgement ? (
          doc.stats && <AcceptanceBar stats={doc.stats} />
        ) : (
          published && <p className="legal-silent-note">Published silently — no acceptance needed</p>
        )}

      </div>

      <div className="legal-actions">
        <Link to={`/legal/${doc.documentType}`} className="btn-primary" style={{ textDecoration: 'none' }}>
          <span>Manage document</span>
          <ArrowRight size={14} />
        </Link>
        {published && (
          <a
            className="legal-link"
            href={publicUrl(doc.path)}
            target="_blank"
            rel="noopener noreferrer"
          >
            View on website
            <ExternalLink size={13} />
          </a>
        )}
      </div>
    </article>
  );
};
