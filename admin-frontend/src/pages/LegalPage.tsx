import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { legalApi, type LegalDocumentSummary } from './legal/legalApi';
import { formatDate, publicUrl } from './legal/legalFormat';
import { AcceptanceBar } from './legal/LegalBits';
import { NotifyDialog } from './legal/NotifyDialog';
import { AlertTriangle, ArrowRight, BookOpen, ExternalLink, Megaphone } from '../components/icons';
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
    <div>
      <div className="page-header">
        <div>
          <h2 className="page-title">Legal documents</h2>
          <p className="page-subtitle">
            What the website publishes. Edits go into a draft; publishing creates a new
            version, and every past version stays readable.
          </p>
        </div>
        <button
          type="button"
          className="btn-secondary legal-notify-btn"
          onClick={() => setNotifying(true)}
          disabled={documents.length === 0}
        >
          <Megaphone size={15} />
          <span>Notify users of an update</span>
        </button>
      </div>

      {isLoading && !data ? (
        <div className="legal-grid">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="legal-skeleton" />
          ))}
        </div>
      ) : isError && !data ? (
        <div className="glass-panel" style={{ padding: '2.5rem 1.5rem', textAlign: 'center' }}>
          <AlertTriangle size={36} style={{ color: 'var(--color-text-dim)', margin: '0 auto 0.6rem' }} />
          <p style={{ color: 'var(--color-text-light)', fontSize: '0.85rem', marginBottom: '1rem' }}>
            The documents could not be loaded.
          </p>
          <button type="button" className="btn-secondary" onClick={() => void refetch()}>
            Try again
          </button>
        </div>
      ) : (
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
    <div className="glass-panel legal-card">
      <div className="legal-card-head">
        <span className="legal-icon-tile">
          <BookOpen size={18} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="legal-card-title">{doc.label}</div>
          <div className="legal-badges">
            {published ? (
              <span className="badge badge-success">Live · v{published.versionNumber}</span>
            ) : (
              <span className="badge badge-danger">Never published</span>
            )}
            {doc.draft && <span className="badge badge-warning">Draft · v{doc.draft.versionNumber}</span>}
            {published?.requiresAcknowledgement && <span className="badge badge-info">Notified</span>}
          </div>
        </div>
      </div>

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

      <div className="legal-actions">
        <Link to={`/legal/${doc.documentType}`} className="btn-primary" style={{ textDecoration: 'none' }}>
          <span>Open</span>
          <ArrowRight size={14} />
        </Link>
        {published && (
          <a
            className="legal-link"
            href={publicUrl(doc.path)}
            target="_blank"
            rel="noopener noreferrer"
            style={{ marginLeft: 'auto' }}
          >
            View on website
            <ExternalLink size={13} />
          </a>
        )}
      </div>
    </div>
  );
};
