import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, ExternalLink } from '../../components/icons';
import { legalApi } from './legalApi';
import { formatDate, publicUrl } from './legalFormat';
import { DocumentPreview, LegalModal } from './LegalBits';

/** One version's text, read-only, rendered like the public page. */
export const VersionViewer: React.FC<{
  versionId: string;
  path: string;
  onClose: () => void;
  onRestore?: () => void;
  /** Why Restore is not offered, shown in the footer instead of the button. */
  restoreBlockedReason?: string;
}> = ({ versionId, path, onClose, onRestore, restoreBlockedReason }) => {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['adminLegalVersion', versionId],
    queryFn: () => legalApi.getVersion(versionId),
    staleTime: 5 * 60_000,
  });

  return (
    <LegalModal
      title={data ? `${data.title} · v${data.versionNumber}` : 'Version'}
      subtitle={
        data
          ? `${data.status === 'DRAFT' ? 'Draft' : data.isCurrent ? 'Live' : 'Archived'} · effective ${formatDate(data.effectiveAt)}`
          : undefined
      }
      onClose={onClose}
      width={860}
      footer={
        <>
          {!onRestore && restoreBlockedReason && data && !data.isCurrent && data.status !== 'DRAFT' && (
            <span className="legal-footer-reason">{restoreBlockedReason}</span>
          )}
          {data && data.status !== 'DRAFT' && (
            <a
              className="btn-secondary"
              href={publicUrl(path, data.isCurrent ? undefined : data.versionNumber)}
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: 'none' }}
            >
              <ExternalLink size={14} />
              <span>View on website</span>
            </a>
          )}
          {onRestore && data && !data.isCurrent && data.status !== 'DRAFT' && (
            <button type="button" className="btn-primary" onClick={onRestore}>
              <Clock size={14} />
              <span>Restore as draft</span>
            </button>
          )}
        </>
      }
    >
      {isLoading && <div className="legal-skeleton" />}
      {isError && (
        <p style={{ color: 'var(--color-text-light)', fontSize: '0.85rem' }}>
          This version could not be loaded.
        </p>
      )}
      {data && (
        <div style={{ border: '1px solid var(--color-border)', borderRadius: 12 }}>
          <DocumentPreview title={data.title} subtitle={data.subtitle} html={data.content} />
        </div>
      )}
    </LegalModal>
  );
};
