import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  legalApi,
  type LegalDocumentSummary,
  type LegalDocumentType,
} from './legal/legalApi';
import { attribution, formatDate, STATUS_STYLE } from './legal/legalFormat';
import { LegalDocumentDetail } from './legal/LegalDocumentDetail';
import { FileText, ShieldCheck, AlertTriangle, Save } from '../components/icons';

/**
 * Legal & Documents — the Terms, Privacy Policy, Cookie Policy and Community
 * Guidelines.
 *
 * The workflow this section exists to enforce is draft → preview → publish.
 * There is deliberately no control anywhere in it that edits the live text:
 * a published version is the exact wording some user's consent record points
 * at, so changing one in place would make every one of those records a claim
 * about text that no longer exists.
 */
export const LegalPage: React.FC = () => {
  const [selected, setSelected] = useState<LegalDocumentType | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['adminLegalDocuments'],
    queryFn: legalApi.listDocuments,
  });

  if (selected) {
    return (
      <LegalDocumentDetail
        documentType={selected}
        onBack={() => setSelected(null)}
      />
    );
  }

  const documents: LegalDocumentSummary[] = data || [];
  const requiringAck = documents.filter(
    (d) => d.published?.requiresAcknowledgement,
  ).length;
  const withDrafts = documents.filter((d) => d.draft).length;

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 className="page-title">Legal &amp; Documents</h2>
          <p className="page-subtitle">
            The documents Meetifyy publishes. Editing creates a draft; the live
            version is never changed in place, and every published version stays
            readable so a user&apos;s acceptance always points at exact wording.
          </p>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))',
          gap: '0.75rem',
          marginBottom: '1.25rem',
        }}
      >
        <StatTile
          icon={<FileText size={15} />}
          label="Documents"
          value={documents.length}
        />
        <StatTile
          icon={<Save size={15} />}
          label="With a draft"
          value={withDrafts}
          tone={withDrafts > 0 ? '#eab308' : undefined}
        />
        <StatTile
          icon={<ShieldCheck size={15} />}
          label="Require acceptance"
          value={requiringAck}
          tone={requiringAck > 0 ? '#22c55e' : undefined}
        />
      </div>

      {isLoading ? (
        <div
          style={{
            padding: '3rem',
            textAlign: 'center',
            color: 'var(--color-text-dim)',
            fontSize: '0.85rem',
          }}
        >
          Loading documents…
        </div>
      ) : documents.length === 0 ? (
        <div className="glass-panel" style={{ padding: '3rem 1.5rem', textAlign: 'center' }}>
          <AlertTriangle
            size={44}
            style={{ color: 'var(--color-text-dim)', margin: '0 auto 0.75rem', opacity: 0.6 }}
          />
          <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--color-text-main)', marginBottom: '0.35rem' }}>
            No documents
          </h3>
          <p style={{ color: 'var(--color-text-light)', fontSize: '0.85rem' }}>
            Nothing has been published yet.
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '0.75rem' }}>
          {documents.map((doc) => (
            <DocumentRow
              key={doc.documentType}
              doc={doc}
              onOpen={() => setSelected(doc.documentType)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const DocumentRow: React.FC<{
  doc: LegalDocumentSummary;
  onOpen: () => void;
}> = ({ doc, onOpen }) => {
  const published = doc.published;
  const style = STATUS_STYLE[published ? 'PUBLISHED' : 'DRAFT'];

  return (
    <div
      className="glass-panel"
      style={{
        padding: '1.1rem 1.25rem',
        display: 'flex',
        gap: '1rem',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ minWidth: 0, flex: '1 1 min(100%, 300px)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-main)' }}>
            {doc.label}
          </span>
          {published ? (
            <span style={pill(style.bg, style.fg)}>
              Live · v{published.versionNumber}
            </span>
          ) : (
            <span style={pill('rgba(239, 68, 68, 0.18)', '#ef4444')}>
              Never published
            </span>
          )}
          {doc.draft && (
            <span style={pill(STATUS_STYLE.DRAFT.bg, STATUS_STYLE.DRAFT.fg)}>
              Draft · v{doc.draft.versionNumber}
            </span>
          )}
          {published?.requiresAcknowledgement && (
            <span style={pill('rgba(34, 197, 94, 0.18)', '#22c55e')}>
              Acceptance required
            </span>
          )}
        </div>

        <div
          style={{
            marginTop: '0.5rem',
            display: 'flex',
            gap: '1.25rem',
            flexWrap: 'wrap',
            fontSize: '0.78rem',
            color: 'var(--color-text-light)',
          }}
        >
          <span>Last updated {formatDate(published?.publishedAt)}</span>
          <span>Effective {formatDate(published?.effectiveAt)}</span>
          <span>By {attribution(published?.publishedBy ?? null)}</span>
          <span>{doc.publishedVersionCount} version{doc.publishedVersionCount === 1 ? '' : 's'}</span>
        </div>

        {published?.changeSummary && (
          <p
            style={{
              margin: '0.6rem 0 0',
              fontSize: '0.82rem',
              lineHeight: 1.55,
              color: 'var(--color-text-light)',
            }}
          >
            {published.changeSummary}
          </p>
        )}
      </div>

      <button className="btn-secondary" onClick={onOpen}>
        <FileText size={15} />
        <span>Manage</span>
      </button>
    </div>
  );
};

const pill = (bg: string, fg: string): React.CSSProperties => ({
  padding: '0.2rem 0.6rem',
  borderRadius: '9999px',
  fontSize: '0.72rem',
  fontWeight: 600,
  background: bg,
  color: fg,
});

const StatTile: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: number;
  tone?: string;
}> = ({ icon, label, value, tone }) => (
  <div className="glass-panel" style={{ padding: '0.85rem 1rem' }}>
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.4rem',
        color: tone || 'var(--color-text-light)',
        fontSize: '0.75rem',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        fontWeight: 600,
      }}
    >
      {icon}
      <span>{label}</span>
    </div>
    <div style={{ marginTop: '0.35rem', fontSize: '1.4rem', fontWeight: 700, color: 'var(--color-text-main)' }}>
      {value}
    </div>
  </div>
);
