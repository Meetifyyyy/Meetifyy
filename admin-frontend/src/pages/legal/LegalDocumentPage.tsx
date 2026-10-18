import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { pushToast } from '../../components/Toaster';
import { useConfirm } from '../../components/ConfirmProvider';
import {
  ChevronLeft,
  Clock,
  Pencil,
  ExternalLink,
  Eye,
  FileText,
  Loader2,
  Megaphone,
  ShieldCheck,
  Trash2,
} from '../../components/icons';
import {
  isLegalDocumentType,
  legalApi,
  type LegalDocumentType,
  type LegalHistoryEntry,
} from './legalApi';
import { attribution, errorMessage, formatDate, formatDateTime, publicUrl } from './legalFormat';
import { AcceptanceBar, SectionTitle } from './LegalBits';
import { PublishDialog } from './PublishDialog';
import { VersionViewer } from './VersionViewer';
import './legal.css';

/** /legal/:type — the live version, the draft, and the version history. */
export const LegalDocumentPage: React.FC = () => {
  const { type } = useParams();
  if (!isLegalDocumentType(type)) {
    return (
      <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center' }}>
        <p style={{ marginBottom: '1rem' }}>Unknown document.</p>
        <Link to="/legal" className="btn-secondary" style={{ textDecoration: 'none' }}>
          All documents
        </Link>
      </div>
    );
  }
  return <DocumentView documentType={type} />;
};

const DocumentView: React.FC<{ documentType: LegalDocumentType }> = ({ documentType }) => {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [viewing, setViewing] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['adminLegalDocument', documentType],
    queryFn: () => legalApi.getDocument(documentType),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['adminLegalDocument', documentType] });
    void queryClient.invalidateQueries({ queryKey: ['adminLegalDocuments'] });
  };

  const openEditor = () => navigate(`/legal/${documentType}/edit`);

  const startDraft = useMutation({
    mutationFn: (fromVersionId?: string) => legalApi.startDraft(documentType, fromVersionId),
    onSuccess: (_draft, fromVersionId) => {
      if (fromVersionId) pushToast('Older version restored as a draft', 'success');
      invalidate();
      openEditor();
    },
    onError: (e: unknown) => pushToast(errorMessage(e, 'Could not open a draft')),
  });

  const deleteDraft = useMutation({
    mutationFn: () => legalApi.deleteDraft(documentType),
    onSuccess: () => {
      pushToast('Draft discarded', 'success');
      invalidate();
    },
  });

  if (isLoading && !data) {
    return (
      <div style={{ display: 'grid', gap: '1rem' }}>
        <div className="legal-skeleton" style={{ height: 90 }} />
        <div className="legal-skeleton" style={{ height: 260 }} />
      </div>
    );
  }
  if (!data) return null;

  const { published, draft, history } = data;

  const restore = (entry: LegalHistoryEntry) =>
    confirm({
      title: `Restore version ${entry.versionNumber} as a draft?`,
      description:
        'Its text becomes a new draft you can review and publish. Nothing changes on the website until you publish.',
      severity: 'moderate',
      confirmLabel: 'Restore as draft',
      onConfirm: () => startDraft.mutateAsync(entry.id),
    });

  return (
    <div>
      <div className="page-header">
        <div>
          <Link to="/legal" className="legal-link" style={{ marginBottom: '0.5rem' }}>
            <ChevronLeft size={14} />
            All documents
          </Link>
          <h2 className="page-title" style={{ marginTop: '0.35rem' }}>
            {data.label}
          </h2>
          <p className="page-subtitle">
            {published
              ? `Version ${published.versionNumber} is live · published ${formatDate(published.publishedAt)} by ${attribution(published.publishedBy)}`
              : 'This document has never been published.'}
          </p>
        </div>
        {/* One clean group: right-aligned beside the title on a wide screen,
            a full-width row under it on a phone (see .legal-header-actions).
            With a draft open, the draft banner below carries Edit, so the
            header does not repeat it. */}
        {(published || !draft) && (
          <div className="legal-header-actions">
            {published && (
              <a
                className="btn-secondary legal-header-icon-btn"
                href={publicUrl(data.path)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="View on website (opens in a new tab)"
                title="View on website"
                style={{ textDecoration: 'none' }}
              >
                <ExternalLink size={14} aria-hidden="true" />
                <span className="hide-mobile">View on website</span>
              </a>
            )}
            {!draft && (
              <button
                type="button"
                className="btn-primary"
                onClick={() => startDraft.mutate(undefined)}
                disabled={startDraft.isPending}
              >
                {startDraft.isPending ? <Loader2 size={14} className="spin" /> : <Pencil size={14} />}
                <span>Edit</span>
              </button>
            )}
          </div>
        )}
      </div>

      {draft && (
        <div className="glass-panel" style={{ padding: '1rem 1.15rem', borderColor: 'rgba(245, 158, 11, 0.45)' }}>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="legal-icon-tile" style={{ background: 'var(--color-warning-tint)', color: '#B45309' }}>
              <FileText size={18} />
            </span>
            <div style={{ flex: '1 1 240px', minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>
                Draft v{draft.versionNumber}
                {draft.restoredFromVersionId && (
                  <span className="badge badge-neutral" style={{ marginLeft: '0.5rem' }}>
                    Restored from an older version
                  </span>
                )}
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--color-text-light)', marginTop: '0.15rem' }}>
                Last saved {formatDateTime(draft.updatedAt)} · not visible on the website
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn-danger"
                onClick={() =>
                  confirm({
                    title: 'Discard this draft?',
                    description: 'The unpublished changes are deleted. The live version is not affected.',
                    consequences: ['This cannot be undone.'],
                    severity: 'moderate',
                    confirmLabel: 'Discard draft',
                    onConfirm: () => deleteDraft.mutateAsync(),
                  })
                }
              >
                <Trash2 size={14} />
                <span>Discard</span>
              </button>
              <button type="button" className="btn-secondary" onClick={openEditor}>
                <Pencil size={14} />
                <span>Edit</span>
              </button>
              <button type="button" className="btn-primary" onClick={() => setPublishing(true)}>
                <ShieldCheck size={14} />
                <span>Publish…</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {published?.requiresAcknowledgement && history[0]?.stats && (
        <div className="glass-panel" style={{ padding: '1rem 1.15rem', marginTop: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem', fontSize: '0.85rem', fontWeight: 600 }}>
            <Megaphone size={15} style={{ color: 'var(--color-primary)' }} />
            Users are being asked to review version {published.versionNumber}
          </div>
          <AcceptanceBar stats={history[0].stats} />
        </div>
      )}

      <SectionTitle aside={<span style={{ fontSize: '0.75rem', color: 'var(--color-text-dim)' }}>{history.length} version{history.length === 1 ? '' : 's'}</span>}>
        Version history
      </SectionTitle>

      {draft && history.some((v) => !v.isCurrent) && (
        <p className="legal-helper-text" id="legal-restore-blocked">
          Restoring an older version is unavailable while draft v{draft.versionNumber} is open.
          Discard or publish the draft first.
        </p>
      )}

      {history.length === 0 ? (
        <div className="glass-panel" style={{ padding: '2.5rem 1.5rem', textAlign: 'center' }}>
          <Clock size={36} style={{ color: 'var(--color-text-dim)', margin: '0 auto 0.6rem' }} />
          <p style={{ color: 'var(--color-text-light)', fontSize: '0.85rem' }}>
            Versions appear here once they are published.
          </p>
        </div>
      ) : (
        <ol className="legal-timeline">
          {history.map((v) => (
            <li key={v.id} className={`legal-timeline-item${v.isCurrent ? ' is-live' : ''}`}>
              <span className="legal-timeline-dot" aria-hidden="true" />
              <div className="glass-panel legal-timeline-card">
                <div style={{ flex: '1 1 300px', minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.92rem' }}>Version {v.versionNumber}</span>
                    {v.isCurrent ? (
                      <span className="badge badge-success">Live</span>
                    ) : (
                      <span className="badge badge-neutral">Archived</span>
                    )}
                    {v.notified ? (
                      <span className="badge badge-info">Notified</span>
                    ) : (
                      <span className="badge badge-neutral" style={{ opacity: 0.75 }}>Silent</span>
                    )}
                  </div>
                  {v.changeSummary && (
                    <p style={{ margin: '0.45rem 0 0', fontSize: '0.84rem', lineHeight: 1.55 }}>{v.changeSummary}</p>
                  )}
                  <div className="legal-timeline-meta">
                    <span>Published {formatDateTime(v.publishedAt)}</span>
                    <span>By {attribution(v.publishedBy)}</span>
                    <span>Effective {formatDate(v.effectiveAt)}</span>
                  </div>
                  {v.requiresAcknowledgement ? (
                    v.stats && (
                      <div style={{ marginTop: '0.7rem', maxWidth: 420 }}>
                        <AcceptanceBar stats={v.stats} />
                      </div>
                    )
                  ) : (
                    <p className="legal-silent-note">Published silently — no acceptance needed</p>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <button type="button" className="btn-secondary" onClick={() => setViewing(v.id)}>
                    <Eye size={14} />
                    <span>View</span>
                  </button>
                  {!v.isCurrent && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => restore(v)}
                      disabled={!!draft}
                      aria-describedby={draft ? 'legal-restore-blocked' : undefined}
                      title={draft ? 'Discard or publish the current draft first' : undefined}
                      style={draft ? { opacity: 0.55 } : undefined}
                    >
                      <Clock size={14} />
                      <span>Restore as draft</span>
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      {viewing && (
        <VersionViewer
          versionId={viewing}
          path={data.path}
          onClose={() => setViewing(null)}
          restoreBlockedReason={
            draft ? 'Discard or publish the current draft before restoring this version.' : undefined
          }
          onRestore={
            draft
              ? undefined
              : () => {
                  const entry = history.find((h) => h.id === viewing);
                  setViewing(null);
                  if (entry) restore(entry);
                }
          }
        />
      )}

      {publishing && draft && (
        <PublishDialog
          documentType={documentType}
          label={data.label}
          draftVersionNumber={draft.versionNumber}
          totalActiveUsers={data.totalActiveUsers}
          onClose={() => setPublishing(false)}
          onDone={() => {
            setPublishing(false);
            invalidate();
          }}
        />
      )}
    </div>
  );
};
