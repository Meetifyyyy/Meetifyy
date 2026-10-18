import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { pushToast } from '../../components/Toaster';
import { AlertTriangle, ArrowRight, ChevronLeft, Loader2, Megaphone, ShieldCheck } from '../../components/icons';
import { legalApi, type LegalDocumentType } from './legalApi';
import {
  effectiveAtPayload,
  errorMessage,
  formatCount,
  formatDateInput,
  todayInput,
} from './legalFormat';
import { ChoiceCard, Field, LegalModal } from './LegalBits';

const SUMMARY_MIN = 10;
const SUMMARY_MAX = 500;

type ChangeType = 'silent' | 'notify';

/**
 * Publishes the saved draft.
 *
 * Step 1 asks what kind of change this is — nothing is preselected, because
 * the choice decides whether every user is stopped by the update screen.
 * Step 2 says, in plain numbers, who will be affected before anything happens.
 */
export const PublishDialog: React.FC<{
  documentType: LegalDocumentType;
  label: string;
  draftVersionNumber: number;
  totalActiveUsers: number;
  onClose: () => void;
  onDone: () => void;
}> = ({ documentType, label, draftVersionNumber, totalActiveUsers, onClose, onDone }) => {
  const [step, setStep] = useState<'form' | 'confirm'>('form');
  const [changeType, setChangeType] = useState<ChangeType | null>(null);
  const [summary, setSummary] = useState('');
  const [effective, setEffective] = useState(todayInput());
  const [error, setError] = useState<string | null>(null);

  const notify = changeType === 'notify';
  const trimmed = summary.trim();
  const lengthOk = trimmed.length >= SUMMARY_MIN && trimmed.length <= SUMMARY_MAX;
  const summaryValid = notify ? lengthOk : trimmed.length === 0 || lengthOk;
  const canContinue = changeType !== null && summaryValid && !!effective;

  // Why Continue is disabled, in words, next to the button.
  const blockedReason =
    changeType === null
      ? 'Choose what kind of change this is'
      : !summaryValid
        ? trimmed.length > SUMMARY_MAX
          ? `Keep the summary under ${SUMMARY_MAX} characters`
          : `Add a summary of at least ${SUMMARY_MIN} characters`
        : !effective
          ? 'Choose an effective date'
          : null;

  const publish = useMutation({
    mutationFn: () =>
      legalApi.publish(documentType, {
        notifyUsers: notify,
        changeSummary: trimmed || undefined,
        effectiveAt: effectiveAtPayload(effective),
      }),
    onSuccess: (version) => {
      pushToast(
        notify
          ? `${label} v${version.versionNumber} published. Users will see the update screen.`
          : `${label} v${version.versionNumber} published silently.`,
        'success',
      );
      onDone();
    },
    onError: (e: unknown) => {
      setError(errorMessage(e, 'The draft could not be published.'));
      setStep('form');
    },
  });

  const busy = publish.isPending;

  return (
    <LegalModal
      title={step === 'form' ? `Publish ${label}` : 'Confirm publish'}
      subtitle={`Draft v${draftVersionNumber} becomes the live version on the website.`}
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
              disabled={!canContinue}
              style={{ opacity: canContinue ? 1 : 0.55 }}
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
            <button type="button" className="btn-primary" onClick={() => publish.mutate()} disabled={busy}>
              {busy ? <Loader2 size={14} className="spin" /> : <ShieldCheck size={14} />}
              <span>{busy ? 'Publishing…' : notify ? 'Publish and notify' : 'Publish'}</span>
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
          <Field label="What kind of change is this?">
            <div role="radiogroup" style={{ display: 'grid', gap: '0.5rem' }}>
              <ChoiceCard
                name="change-type"
                checked={changeType === 'silent'}
                onSelect={() => setChangeType('silent')}
                title="Don't notify — minor fix (typos, formatting)"
                description="The page updates silently. No one is asked to review it."
              />
              <ChoiceCard
                name="change-type"
                checked={changeType === 'notify'}
                onSelect={() => setChangeType('notify')}
                title="Notify users — show the update screen until they choose Got it"
                description="Every signed-in user sees the update screen on their next visit."
              />
            </div>
          </Field>

          <Field
            label={
              <>
                What changed{' '}
                <span style={{ fontWeight: 500, color: 'var(--color-text-dim)' }}>
                  {notify ? '(required)' : '(optional)'}
                </span>
              </>
            }
            htmlFor="legal-publish-summary"
            aside={`${trimmed.length}/${SUMMARY_MAX}`}
            hint={
              notify
                ? 'Shown to users on the update screen.'
                : 'Kept in the version history. At least 10 characters if you add one.'
            }
          >
            <textarea
              id="legal-publish-summary"
              className="input-control"
              rows={3}
              maxLength={SUMMARY_MAX}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="e.g. We now explain how college email verification works."
            />
          </Field>

          <Field label="Effective date" htmlFor="legal-publish-effective" hint="Up to 90 days ahead.">
            <input
              id="legal-publish-effective"
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
            <dd>{trimmed || <span style={{ color: 'var(--color-text-dim)' }}>No summary</span>}</dd>
          </div>
          <div>
            <dt>Effective</dt>
            <dd>{effective === todayInput() ? `Today (${formatDateInput(effective)})` : formatDateInput(effective)}</dd>
          </div>
        </dl>
        <div className={`legal-callout ${notify ? 'legal-callout-warn' : 'legal-callout-info'}`}>
          {notify ? (
            <Megaphone size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          ) : (
            <ShieldCheck size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          )}
          <span>
            {notify ? (
              <>
                All <strong>{formatCount(totalActiveUsers)}</strong> users will see the update
                screen for <strong>{label}</strong>. They can&apos;t continue until they choose Got
                it or sign out.
              </>
            ) : (
              <>No one will be notified; the page updates silently.</>
            )}
          </span>
        </div>
        </>
      )}
    </LegalModal>
  );
};
