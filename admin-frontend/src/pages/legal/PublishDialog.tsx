import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { pushToast } from '../../components/Toaster';
import { AlertTriangle, Check, Loader2, ShieldCheck } from '../../components/icons';
import {
  legalApi,
  type LegalDocumentType,
  type LegalVersion,
} from './legalApi';

const MIN_SUMMARY = 10;

/**
 * The publish / rollback dialog.
 *
 * Both actions publish a version, so both go through the same form. The change
 * summary is required by the server and required here, because it is what the
 * version history, the audit log and — when acceptance is mandatory — every
 * user's consent modal show as the reason for the change.
 *
 * The mandatory-acknowledgement switch is configured HERE and nowhere else: a
 * published version is immutable, so the decision has to be made before the
 * version exists rather than toggled on it afterwards.
 */
export const PublishDialog: React.FC<{
  documentType: LegalDocumentType;
  label: string;
  mode: 'publish' | 'rollback';
  targetVersion: LegalVersion | null;
  nextVersionNumber: number | null;
  onClose: () => void;
  onDone: () => void;
}> = ({ documentType, label, mode, targetVersion, nextVersionNumber, onClose, onDone }) => {
  const [changeSummary, setChangeSummary] = useState(
    mode === 'rollback' && targetVersion
      ? `Restoring the text of version ${targetVersion.versionNumber}.`
      : '',
  );
  const [effectiveAt, setEffectiveAt] = useState('');
  const [requiresAcknowledgement, setRequiresAcknowledgement] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const summaryTooShort = changeSummary.trim().length < MIN_SUMMARY;

  const publish = useMutation({
    mutationFn: () => {
      const body = {
        changeSummary: changeSummary.trim(),
        // A date-only input means midnight local time, which is what an admin
        // choosing "the 14th" means. Left blank, the server uses now.
        ...(effectiveAt ? { effectiveAt: new Date(effectiveAt).toISOString() } : {}),
        requiresAcknowledgement,
      };
      return mode === 'rollback' && targetVersion
        ? legalApi.rollback(documentType, {
            ...body,
            targetVersionNumber: targetVersion.versionNumber,
          })
        : legalApi.publish(documentType, body);
    },
    onSuccess: (version) => {
      pushToast(
        mode === 'rollback'
          ? `Version ${version.versionNumber} published, restoring earlier text`
          : `Version ${version.versionNumber} published`,
        'success',
      );
      onDone();
    },
    onError: (err: any) =>
      pushToast(err?.message || 'Could not publish this version'),
  });

  const blocked = summaryTooShort || !confirmed || publish.isPending;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={mode === 'rollback' ? 'Restore a version' : 'Publish a version'}>
      <div className="modal-content" style={{ padding: '1.5rem', maxWidth: '560px' }}>
        <h3 style={{ margin: '0 0 0.35rem', fontSize: '1.1rem', fontWeight: 700, color: 'var(--color-text-main)' }}>
          {mode === 'rollback'
            ? `Restore version ${targetVersion?.versionNumber} of the ${label}`
            : `Publish the ${label}`}
        </h3>
        <p style={{ margin: '0 0 1.1rem', fontSize: '0.83rem', lineHeight: 1.55, color: 'var(--color-text-light)' }}>
          {mode === 'rollback' ? (
            <>
              This publishes a <strong>new</strong> version carrying version{' '}
              {targetVersion?.versionNumber}&apos;s text. Nothing in the history
              is changed or removed, so every existing acceptance still points at
              the version it was given.
            </>
          ) : (
            <>
              {nextVersionNumber ? `Version ${nextVersionNumber} ` : 'This draft '}
              becomes the live document immediately. The current version is
              archived, not deleted, and stays readable.
            </>
          )}
        </p>

        <Field
          label="Reason for this change"
          hint="Shown in the version history, the audit log, and to every user if you require acceptance below."
        >
          <textarea
            className="input-control"
            rows={3}
            value={changeSummary}
            placeholder="e.g. Clarified how long we keep message history after account deletion."
            onChange={(e) => setChangeSummary(e.target.value)}
          />
          {summaryTooShort && changeSummary.length > 0 && (
            <p style={{ margin: '0.35rem 0 0', fontSize: '0.74rem', color: '#eab308' }}>
              At least {MIN_SUMMARY} characters.
            </p>
          )}
        </Field>

        <Field label="Effective date" hint="Left blank, this takes effect now.">
          <input
            type="date"
            className="input-control"
            value={effectiveAt}
            onChange={(e) => setEffectiveAt(e.target.value)}
          />
        </Field>

        <label
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.55rem',
            margin: '1rem 0 0.5rem',
            padding: '0.85rem 1rem',
            borderRadius: '10px',
            border: '1px solid var(--color-border)',
            background: requiresAcknowledgement ? 'rgba(34, 197, 94, 0.08)' : 'transparent',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={requiresAcknowledgement}
            onChange={(e) => setRequiresAcknowledgement(e.target.checked)}
            style={{ marginTop: '0.15rem', flexShrink: 0 }}
          />
          <span style={{ fontSize: '0.85rem', lineHeight: 1.55, color: 'var(--color-text-main)' }}>
            <strong style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <ShieldCheck size={14} />
              Require users to review and accept this change
            </strong>
            <span style={{ display: 'block', marginTop: '0.3rem', color: 'var(--color-text-light)' }}>
              Every user who has not accepted this exact version is blocked from
              using Meetifyy until they do. Cannot be changed after publishing —
              a published version is immutable.
            </span>
          </span>
        </label>

        {requiresAcknowledgement && (
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.5rem',
              padding: '0.7rem 0.9rem',
              marginBottom: '0.75rem',
              borderRadius: '10px',
              background: 'rgba(234, 179, 8, 0.12)',
              color: '#eab308',
              fontSize: '0.8rem',
              lineHeight: 1.5,
            }}
          >
            <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: '0.1rem' }} />
            <span>
              This affects the entire user base at once. Everyone will see a
              consent screen on their next request and cannot use Meetifyy until
              they accept.
            </span>
          </div>
        )}

        <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.55rem', margin: '0.75rem 0 1.1rem', fontSize: '0.83rem', color: 'var(--color-text-main)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            style={{ marginTop: '0.15rem', flexShrink: 0 }}
          />
          <span>
            I have previewed this version and understand it becomes the public{' '}
            {label} immediately.
          </span>
        </label>

        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }} className="modal-actions">
          <button className="btn-secondary" onClick={onClose} disabled={publish.isPending}>
            Cancel
          </button>
          <button className="btn-primary" onClick={() => publish.mutate()} disabled={blocked}>
            {publish.isPending ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
            <span>
              {publish.isPending
                ? 'Publishing…'
                : mode === 'rollback'
                  ? 'Publish restored version'
                  : 'Publish now'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};

const Field: React.FC<{
  label: string;
  hint?: string;
  children: React.ReactNode;
}> = ({ label, hint, children }) => (
  <div style={{ marginBottom: '0.9rem' }}>
    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text-light)', marginBottom: '0.35rem' }}>
      {label}
    </label>
    {children}
    {hint && (
      <p style={{ margin: '0.35rem 0 0', fontSize: '0.74rem', lineHeight: 1.5, color: 'var(--color-text-dim)' }}>
        {hint}
      </p>
    )}
  </div>
);
