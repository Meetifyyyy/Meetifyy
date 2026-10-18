import React, { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { pushToast } from '../../components/Toaster';
import { AlertTriangle, ArrowRight, ChevronLeft, Info, Loader2, Megaphone } from '../../components/icons';
import { legalApi, type LegalDocumentSummary, type LegalDocumentType } from './legalApi';
import {
  effectiveAtPayload,
  errorMessage,
  formatCount,
  formatDateInput,
  joinNames,
  todayInput,
} from './legalFormat';
import { ChoiceCard, Field, LegalModal } from './LegalBits';

const SUMMARY_MIN = 10;
const SUMMARY_MAX = 500;

/**
 * Asks users to review the CURRENT text of one or more documents, without
 * publishing new text — a notified copy of each live version. For a text
 * change, edit the document and publish with "Notify users" instead.
 */
export const NotifyDialog: React.FC<{
  documents: LegalDocumentSummary[];
  onClose: () => void;
  onDone: () => void;
}> = ({ documents, onClose, onDone }) => {
  const [step, setStep] = useState<'form' | 'confirm'>('form');
  const [selected, setSelected] = useState<LegalDocumentType[]>([]);
  const [summary, setSummary] = useState('');
  const [effective, setEffective] = useState(todayInput());
  const [error, setError] = useState<string | null>(null);

  const { data: audience } = useQuery({
    queryKey: ['adminLegalAudience'],
    queryFn: legalApi.audience,
    staleTime: 60_000,
  });

  const trimmed = summary.trim();
  const valid =
    selected.length > 0 &&
    trimmed.length >= SUMMARY_MIN &&
    trimmed.length <= SUMMARY_MAX &&
    !!effective;
  const blockedReason =
    selected.length === 0
      ? 'Choose at least one document'
      : trimmed.length < SUMMARY_MIN
        ? `Add a summary of at least ${SUMMARY_MIN} characters`
        : trimmed.length > SUMMARY_MAX
          ? `Keep the summary under ${SUMMARY_MAX} characters`
          : !effective
            ? 'Choose an effective date'
            : null;
  const labels = documents
    .filter((d) => selected.includes(d.documentType))
    .map((d) => d.label);

  const notify = useMutation({
    mutationFn: () =>
      legalApi.notify({
        documentTypes: selected,
        changeSummary: trimmed,
        effectiveAt: effectiveAtPayload(effective),
      }),
    onSuccess: () => {
      pushToast(`Users will see the update screen for ${joinNames(labels)}.`, 'success');
      onDone();
    },
    onError: (e: unknown) => {
      setError(errorMessage(e, 'The notice could not be sent.'));
      setStep('form');
    },
  });
  const busy = notify.isPending;

  const toggle = (type: LegalDocumentType) =>
    setSelected((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );

  return (
    <LegalModal
      title={step === 'form' ? 'Notify users of an update' : 'Confirm notice'}
      subtitle="Shows the update screen for the current version of each document you choose."
      onClose={onClose}
      busy={busy}
      footer={
        step === 'form' ? (
          <>
            {blockedReason && (
              <span className="legal-footer-reason" role="status">
                {blockedReason}
              </span>
            )}
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!valid}
              style={{ opacity: valid ? 1 : 0.55 }}
              onClick={() => {
                setError(null);
                setStep('confirm');
              }}
            >
              <span>Continue</span>
              <ArrowRight size={14} />
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn-secondary" onClick={() => setStep('form')} disabled={busy}>
              <ChevronLeft size={14} />
              <span>Back</span>
            </button>
            <button type="button" className="btn-primary" onClick={() => notify.mutate()} disabled={busy}>
              {busy ? <Loader2 size={14} className="spin" /> : <Megaphone size={14} />}
              <span>{busy ? 'Notifying…' : 'Notify'}</span>
            </button>
          </>
        )
      }
    >
      {error && (
        <div className="legal-callout legal-callout-warn" role="alert" style={{ marginBottom: '1rem' }}>
          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{error}</span>
        </div>
      )}

      {step === 'form' ? (
        <>
          <div className="legal-callout legal-callout-info" style={{ marginBottom: '1rem' }}>
            <Info size={15} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>
              <strong>This publishes no new text.</strong> To change the wording, edit the
              document and publish it with &ldquo;Notify users&rdquo;. This only asks users to
              review what is live now.
            </span>
          </div>

          <Field label="Documents">
            <div style={{ display: 'grid', gap: '0.45rem' }}>
              {documents.map((d) => (
                <ChoiceCard
                  key={d.documentType}
                  type="checkbox"
                  name="notify-docs"
                  checked={selected.includes(d.documentType)}
                  disabled={!d.published}
                  onSelect={() => toggle(d.documentType)}
                  title={d.label}
                  description={
                    d.published
                      ? `Live version ${d.published.versionNumber}`
                      : 'Never published — nothing to notify about'
                  }
                />
              ))}
            </div>
          </Field>

          <Field
            label="What changed"
            htmlFor="legal-notify-summary"
            aside={`${trimmed.length}/${SUMMARY_MAX}`}
            hint="Shown to users on the update screen."
          >
            <textarea
              id="legal-notify-summary"
              className="input-control"
              rows={3}
              maxLength={SUMMARY_MAX}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
          </Field>

          <Field label="Effective date" htmlFor="legal-notify-effective">
            <input
              id="legal-notify-effective"
              type="date"
              className="input-control"
              value={effective}
              max={todayInput(90)}
              onChange={(e) => setEffective(e.target.value)}
            />
          </Field>
        </>
      ) : (
        <>
        <dl className="legal-confirm-summary">
          <div>
            <dt>What changed</dt>
            <dd>{trimmed}</dd>
          </div>
          <div>
            <dt>Effective</dt>
            <dd>{effective === todayInput() ? `Today (${formatDateInput(effective)})` : formatDateInput(effective)}</dd>
          </div>
        </dl>
        <div className="legal-callout legal-callout-warn">
          <Megaphone size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>
            Users will see the update screen for: <strong>{labels.join(', ')}</strong>. They
            can&apos;t continue until they choose Got it or sign out.
            {audience && (
              <> That is up to <strong>{formatCount(audience.totalActiveUsers)}</strong> users.</>
            )}
          </span>
        </div>
        </>
      )}
    </LegalModal>
  );
};
