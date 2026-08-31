import { useState } from 'react';
import { useAuth } from '@shared/context/AuthContext';
import { showToast } from '@shared/utils/toast';
import { Upload, Loader2, CheckCircle2, AlertCircle } from '@shared/components/icons';
import { apiClient } from '@shared/api/apiClient';
import styles from '../pages/SettingsRoute.module.css';
import { VERIFICATION_ALLOWED_TYPES } from '@shared/constants/mediaLimits';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import VerificationCameraCapture from './VerificationCameraCapture';
import {
  prepareVerificationDocument,
  readUploadedMediaId,
  validateVerificationDocument,
  VerificationDocumentError,
} from '@shared/utils/verificationMedia';

// The picker filter matches the server allowlist exactly, so the dialog cannot
// offer a format the upload will then refuse.
const VERIFICATION_ACCEPT = VERIFICATION_ALLOWED_TYPES.join(',');

export default function SettingsVerificationPanel() {
  const { currentUser } = useAuth();
  const queryClient = useQueryClient();
  const [selfieFile, setSelfieFile] = useState(null);
  const [collegeIdFile, setCollegeIdFile] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Which document the last failure was about, so the error sits next to the
  // input the user has to fix rather than only in a toast that scrolls away.
  const [fieldError, setFieldError] = useState(null);
  const [stage, setStage] = useState(null);

  /**
   * The persisted verification state, which is the authority here.
   *
   * This panel used to read `currentUser.verificationStatus` alone. That is a
   * cached copy of the user row: after a refresh, a re-login, a second tab or a
   * PWA reload it could still say UNVERIFIED while a request sat pending in the
   * database — so the submission form was offered again to someone who had
   * already submitted, and a duplicate was only stopped once the server
   * refused it.
   */
  const { data: verification, isLoading: verificationLoading } = useQuery({
    queryKey: ['verificationStatus'],
    queryFn: () => apiClient.get('/api/verification/status'),
    staleTime: 30_000,
  });

  const history = verification?.history ?? [];
  const latestAttempt = verification?.request ?? null;
  // Server first; the cached user row is only a fallback for the first paint.
  const status =
    verification?.status || currentUser?.verificationStatus || 'UNVERIFIED';
  // Keyed on the request, not the user flag, so a stale flag cannot put the
  // form back in front of someone who is already waiting on a review.
  const isUnderReview =
    verification?.hasPendingRequest ?? status === 'PENDING';
  const rejectionReason =
    latestAttempt?.status === 'REJECTED' ||
    latestAttempt?.status === 'RESUBMISSION_REQUIRED'
      ? latestAttempt.rejectionReason
      : null;

  const formatStamp = (value) =>
    value
      ? new Date(value).toLocaleString(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
        })
      : null;

  // Validate at pick time, not at submit time. Catching an unsupported format or
  // an unreadable file here means the user finds out while they are still
  // looking at the picker, instead of after two uploads have already run.
  const handleFileChange = async (e, setFile, label) => {
    const file = e.target.files?.[0];
    // Reset so re-picking the same file after an error fires onChange again.
    e.target.value = '';
    if (!file) return;
    try {
      await validateVerificationDocument(file, label);
      setFieldError(null);
      setFile(file);
    } catch (err) {
      setFile(null);
      setFieldError({ label, message: err.message });
      showToast(err.message, 'error');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!selfieFile || !collegeIdFile) {
      const missing = !selfieFile ? 'selfie' : 'college ID';
      setFieldError({ label: missing, message: `Please provide your ${missing}.` });
      showToast(`Please provide your ${missing}.`, 'error');
      return;
    }

    setIsSubmitting(true);
    setFieldError(null);

    // Keys of anything we successfully put in storage. If the submission does
    // not complete, these are discarded — otherwise a failed attempt leaves the
    // documents sitting in the bucket with no request referencing them. That is
    // not hypothetical: the live bucket currently holds exactly two such orphans
    // from a submission that failed before it ever reached the database.
    const uploadedKeys = [];

    try {
      setStage('Preparing your documents…');
      // Converted to WebP with EXIF reset, at a quality that keeps ID text
      // readable. Prepared before either upload starts so a bad image fails
      // without anything having been stored.
      const [selfieUpload, collegeIdUpload] = await Promise.all([
        prepareVerificationDocument(selfieFile, 'selfie'),
        prepareVerificationDocument(collegeIdFile, 'college ID'),
      ]);

      setStage('Uploading…');
      const { uploadsApi, apiClient } = await import('@shared/api/apiClient');

      // Sequential, and deliberately so: the two documents are told apart only
      // by which field they land in, so the order they are prepared, uploaded
      // and read back stays fixed and readable end to end. Two files is not a
      // meaningful amount of parallelism to give up.
      const selfieRes = await uploadsApi.uploadMedia(selfieUpload, 'verification');
      if (selfieRes?.key) uploadedKeys.push(selfieRes.key);
      const selfieMediaId = readUploadedMediaId(selfieRes, 'selfie');

      const collegeIdRes = await uploadsApi.uploadMedia(collegeIdUpload, 'verification');
      if (collegeIdRes?.key) uploadedKeys.push(collegeIdRes.key);
      const idCardMediaId = readUploadedMediaId(collegeIdRes, 'college ID');

      setStage('Submitting for review…');
      await apiClient.post('/api/verification/request', {
        selfieMediaId,
        idCardMediaId,
      });

      // Only now is anything referencing the uploads, so nothing is orphaned.
      uploadedKeys.length = 0;

      showToast('Verification request submitted successfully', 'success');
      setSelfieFile(null);
      setCollegeIdFile(null);

      // Awaited, not fired and forgotten. The old code raced an un-awaited sync
      // against a 1-second reload timer, so the page could reload before the
      // status it was reloading to show had been fetched.
      await apiClient.post('/api/auth/sync').catch(() => {});
      // The panel keys off this query, so it has to be refetched before the
      // "in review" state can replace the form.
      await queryClient.invalidateQueries({ queryKey: ['verificationStatus'] });
      await queryClient.invalidateQueries();
    } catch (err) {
      if (uploadedKeys.length > 0) {
        const { uploadsApi } = await import('@shared/api/apiClient');
        await Promise.all(
          uploadedKeys.map((key) => uploadsApi.discard(key).catch(() => {})),
        );
      }
      if (err instanceof VerificationDocumentError) {
        setFieldError({ label: err.label, message: err.message });
      }
      showToast(err?.message || 'Failed to submit verification request', 'error');
    } finally {
      setStage(null);
      setIsSubmitting(false);
    }
  };

  return (
    <div className={`${styles.body} animate-in`}>
      <div className={styles.group} style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-main, var(--color-text))', margin: 0 }}>
              Current Status
            </h3>
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '2px 8px',
              borderRadius: '9999px',
              fontSize: '0.75rem',
              fontWeight: 500,
              textTransform: 'capitalize',
              backgroundColor: 
                status === 'VERIFIED' ? 'rgba(34, 197, 94, 0.12)' : 
                status === 'PENDING' ? 'rgba(234, 179, 8, 0.12)' : 
                status === 'REJECTED' ? 'rgba(239, 68, 68, 0.12)' : 
                'rgba(148, 163, 184, 0.12)',
              color: 
                status === 'VERIFIED' ? '#22c55e' : 
                status === 'PENDING' ? '#eab308' : 
                status === 'REJECTED' ? '#ef4444' : 
                'var(--color-text-muted, #94a3b8)'
            }}>
              {status.toLowerCase()}
            </span>
          </div>
          <p style={{ fontSize: '0.815rem', color: 'var(--color-text-muted, var(--color-text-light))', margin: '0.35rem 0 0', lineHeight: 1.45 }}>
            Verification unlocks campus features, messaging, and community access.
          </p>
        </div>

        {status === 'VERIFIED' && (
          <div style={{ background: 'rgba(34, 197, 94, 0.1)', border: '1px solid rgba(34, 197, 94, 0.2)', padding: '1rem', borderRadius: '12px', display: 'flex', gap: '0.75rem', alignItems: 'flex-start', marginTop: '1rem' }}>
            <CheckCircle2 size={20} color="#22c55e" style={{ flexShrink: 0, marginTop: '2px' }} />
            <div>
              <p style={{ color: 'var(--color-text)', fontWeight: 500 }}>You are fully verified.</p>
              <p style={{ color: 'var(--color-text-light)', fontSize: '0.875rem', marginTop: '0.25rem' }}>Thank you for helping keep the Meetifyy community safe and authentic.</p>
            </div>
          </div>
        )}

        {isUnderReview && (
          <div style={{ background: 'rgba(234, 179, 8, 0.1)', border: '1px solid rgba(234, 179, 8, 0.2)', padding: '1rem', borderRadius: '12px', display: 'flex', gap: '0.75rem', alignItems: 'flex-start', marginTop: '1rem' }}>
            <Loader2 size={20} color="#eab308" style={{ flexShrink: 0, marginTop: '2px' }} className="spinner" />
            <div>
              <p style={{ color: 'var(--color-text)', fontWeight: 500 }}>Verification in review</p>
              <p style={{ color: 'var(--color-text-light)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
                Your verification request was submitted successfully
                {latestAttempt?.createdAt ? ` on ${formatStamp(latestAttempt.createdAt)}` : ''}
                {' '}and your documents are being reviewed.
              </p>
              <p style={{ color: 'var(--color-text-light)', fontSize: '0.875rem', marginTop: '0.5rem' }}>
                You do not need to submit anything again. We will notify you as
                soon as the review is complete — this usually takes less than 24 hours.
              </p>
            </div>
          </div>
        )}

        {verificationLoading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '1rem', color: 'var(--color-text-light)', fontSize: '0.875rem' }}>
            <Loader2 size={16} className="spinner" />
            <span>Checking your verification status…</span>
          </div>
        )}

        {!verificationLoading && !isUnderReview &&
          (status === 'UNVERIFIED' || status === 'REJECTED' || status === 'RESUBMISSION_REQUIRED') && (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginTop: '1rem' }}>
            {(status === 'REJECTED' || status === 'RESUBMISSION_REQUIRED') && (
              <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', padding: '1rem', borderRadius: '12px', display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                <AlertCircle size={20} color="#ef4444" style={{ flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <p style={{ color: 'var(--color-text)', fontWeight: 500 }}>Verification rejected</p>
                  {/* The reviewer's actual words, read from the request. This
                      used to be a fixed sentence about blurry photos, which
                      told the user nothing about their own submission. */}
                  {rejectionReason ? (
                    <>
                      <p style={{ color: 'var(--color-text-light)', fontSize: '0.8125rem', marginTop: '0.5rem', fontWeight: 500 }}>Reason:</p>
                      <p style={{ color: 'var(--color-text)', fontSize: '0.875rem', marginTop: '0.125rem', whiteSpace: 'pre-wrap' }}>
                        {rejectionReason}
                      </p>
                    </>
                  ) : (
                    <p style={{ color: 'var(--color-text-light)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
                      No reason was recorded for this decision.
                    </p>
                  )}
                  <p style={{ color: 'var(--color-text-light)', fontSize: '0.875rem', marginTop: '0.5rem' }}>
                    Correct the issue above and submit a new request below.
                  </p>
                </div>
              </div>
            )}

            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>1. Take a clear selfie</label>
              <p style={{ fontSize: '0.75rem', color: 'var(--color-text-light)', marginBottom: '0.75rem' }}>This helps us verify you are a real person.</p>
              <VerificationCameraCapture
                value={selfieFile}
                onChange={setSelfieFile}
                isSubmitting={isSubmitting}
              />
              {fieldError?.label === 'selfie' && (
                <p role="alert" style={{ fontSize: '0.78rem', color: '#ef4444', margin: '0.5rem 0 0' }}>
                  {fieldError.message}
                </p>
              )}
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>2. Upload your College ID</label>
              <p style={{ fontSize: '0.75rem', color: 'var(--color-text-light)', marginBottom: '0.75rem' }}>We use this to confirm your student status. Only our review team can see it.</p>
              <input type="file" accept={VERIFICATION_ACCEPT} onChange={(e) => handleFileChange(e, setCollegeIdFile, 'college ID')} style={{ display: 'none' }} id="id-upload" />
              <label htmlFor="id-upload" style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                padding: '1rem', background: 'var(--color-bg-panel)', border: '1px dashed var(--color-border)', borderRadius: '8px',
                cursor: 'pointer', transition: 'border-color 0.2s'
              }}>
                <Upload size={18} color="var(--color-text-light)" />
                <span style={{ color: collegeIdFile ? 'var(--color-text)' : 'var(--color-text-light)', fontSize: '0.875rem' }}>
                  {collegeIdFile ? collegeIdFile.name : 'Choose your College ID photo'}
                </span>
              </label>
              {fieldError?.label === 'college ID' && (
                <p role="alert" style={{ fontSize: '0.78rem', color: '#ef4444', margin: '0.5rem 0 0' }}>
                  {fieldError.message}
                </p>
              )}
            </div>

            <button type="submit" disabled={isSubmitting || !selfieFile || !collegeIdFile} style={{
              marginTop: '0.5rem',
              padding: '0.875rem',
              borderRadius: '9999px',
              background: 'var(--color-brand, var(--color-primary, #2563eb))',
              color: 'white',
              fontWeight: 600,
              fontSize: '1rem',
              border: 'none',
              cursor: (isSubmitting || !selfieFile || !collegeIdFile) ? 'not-allowed' : 'pointer',
              opacity: (isSubmitting || !selfieFile || !collegeIdFile) ? 0.5 : 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem'
            }}>
              {isSubmitting ? (
                <>
                  <Loader2 size={18} className="spinner" />
                  <span>{stage || 'Submitting…'}</span>
                </>
              ) : (
                'Submit for Verification'
              )}
            </button>
          </form>
        )}
      </div>

      {history.length > 0 && (
        <div className={styles.group} style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
          <div>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-main, var(--color-text))', margin: 0 }}>
              Verification history
            </h3>
            <p style={{ color: 'var(--color-text-light)', fontSize: '0.8125rem', marginTop: '0.25rem' }}>
              Every request you have submitted. Newest first.
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {history.map((attempt) => {
              const tone =
                attempt.status === 'VERIFIED'
                  ? { fg: '#22c55e', bg: 'rgba(34, 197, 94, 0.12)', label: 'Approved' }
                  : attempt.status === 'PENDING'
                    ? { fg: '#eab308', bg: 'rgba(234, 179, 8, 0.12)', label: 'Under review' }
                    : { fg: '#ef4444', bg: 'rgba(239, 68, 68, 0.12)', label: 'Rejected' };
              return (
                <div
                  key={attempt.id}
                  style={{
                    border: '1px solid var(--color-border, rgba(255,255,255,0.08))',
                    borderRadius: '12px',
                    padding: '0.875rem 1rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
                    <p style={{ margin: 0, fontWeight: 600, color: 'var(--color-text)' }}>
                      Attempt {attempt.attemptNumber}
                    </p>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center',
                      padding: '2px 8px', borderRadius: '9999px',
                      fontSize: '0.75rem', fontWeight: 500,
                      background: tone.bg, color: tone.fg,
                    }}>
                      {tone.label}
                    </span>
                  </div>

                  <p style={{ margin: '0.35rem 0 0', fontSize: '0.8125rem', color: 'var(--color-text-light)' }}>
                    Submitted: {formatStamp(attempt.createdAt)}
                  </p>
                  {attempt.reviewedAt && (
                    <p style={{ margin: '0.125rem 0 0', fontSize: '0.8125rem', color: 'var(--color-text-light)' }}>
                      Reviewed: {formatStamp(attempt.reviewedAt)}
                    </p>
                  )}
                  {attempt.rejectionReason && (
                    <p style={{ margin: '0.4rem 0 0', fontSize: '0.8125rem', color: 'var(--color-text)', whiteSpace: 'pre-wrap' }}>
                      <span style={{ color: 'var(--color-text-light)' }}>Reason: </span>
                      {attempt.rejectionReason}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
