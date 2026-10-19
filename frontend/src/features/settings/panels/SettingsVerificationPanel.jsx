import { useState } from 'react';
import { useAuth } from '@shared/context/AuthContext';
import { showToast } from '@shared/utils/toast';
import { Clock, CheckCircle2, AlertCircle, Camera, User } from '@shared/components/icons';
import { apiClient } from '@shared/api/apiClient';
import styles from '../pages/SettingsRoute.module.css';
import methodStyles from './SettingsVerificationPanel.module.css';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Skeleton from '@shared/components/skeletons/Skeleton';
import VerificationCameraCapture from './VerificationCameraCapture';

/**
 * The two ways to verify. Either one is enough on its own, and both are live:
 * the photo comes from the camera, never from a file. The server enforces the
 * same (see VerificationService.captureDocument / submitLiveVerification).
 */
const METHODS = [
  {
    method: 'LIVE_SELFIE',
    kind: 'selfie',
    icon: User,
    title: 'Live selfie',
    text: 'Take a photo of your face with the front camera.',
  },
  {
    method: 'LIVE_GOVERNMENT_ID',
    kind: 'id',
    icon: Camera,
    title: 'Live photo of a government ID',
    text: 'Photograph your Aadhaar, PAN, passport or driving licence with the camera.',
  },
];

export default function SettingsVerificationPanel() {
  const { currentUser } = useAuth();
  const queryClient = useQueryClient();
  // Which of METHODS the person chose; null until they pick one.
  const [method, setMethod] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Shown under the camera rather than only in a toast that scrolls away.
  const [captureError, setCaptureError] = useState(null);
  const [stage, setStage] = useState(null);
  const chosen = METHODS.find((m) => m.method === method) ?? null;

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

  const chooseMethod = (next) => {
    if (isSubmitting) return;
    setMethod(next);
    setPhoto(null);
    setCaptureError(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSubmitting || !chosen) return;
    if (!photo) {
      setCaptureError(`Take your ${chosen.kind === 'selfie' ? 'selfie' : 'ID photo'} first.`);
      return;
    }

    setIsSubmitting(true);
    setCaptureError(null);
    try {
      setStage('Uploading…');
      // The server decodes and re-encodes the frame (no EXIF, no device or
      // location data) and stores it privately; only reviewers can see it.
      const form = new FormData();
      form.append('kind', chosen.kind);
      form.append('file', photo);
      const { mediaId } = await apiClient.post('/api/verification/capture', form);

      setStage('Submitting for review…');
      await apiClient.post('/api/verification/live-request', {
        method: chosen.method,
        mediaId,
      });

      showToast('Verification request submitted', 'success');
      setPhoto(null);
      setMethod(null);

      // Awaited so the "in review" card replaces the form only once the new
      // status has actually been fetched.
      await apiClient.post('/api/auth/sync').catch(() => {});
      await queryClient.invalidateQueries({ queryKey: ['verificationStatus'] });
      await queryClient.invalidateQueries();
    } catch (err) {
      // An unsubmitted capture is collected by the server after a day
      // (VerificationUploadCollectorService); nothing to clean up here.
      const message = err?.message || 'Failed to submit verification request';
      setCaptureError(message);
      showToast(message, 'error');
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
            Verifying with a live selfie or a live photo of your government ID unlocks messaging, posting, creating communities and activities, and Instant Match. Campus opens with your college email.
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
          <div className={styles.reviewCard} role="status">
            <div className={styles.reviewIcon} aria-hidden="true">
              <Clock size={18} strokeWidth={2.2} />
            </div>
            <div className={styles.reviewBody}>
              <p className={styles.reviewTitle}>Verification in review</p>
              <p className={styles.reviewText}>
                Your verification request was submitted successfully
                {latestAttempt?.createdAt ? ` on ${formatStamp(latestAttempt.createdAt)}` : ''}
                {' '}and your documents are being reviewed. You do not need to submit
                anything again. We will notify you as soon as the review is complete,
                which usually takes less than 24 hours.
              </p>
            </div>
          </div>
        )}

        {verificationLoading && (
          // One coarse block where the review card or the submission form
          // will land; which of the two is not known until this resolves.
          <div role="status" aria-label="Checking your verification status" style={{ marginTop: '1rem' }}>
            <Skeleton type="rect" width="100%" height="88px" style={{ display: 'block', borderRadius: '12px' }} />
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

            <fieldset className={methodStyles.methods} disabled={isSubmitting}>
              <legend className={methodStyles.legend}>Choose how to verify</legend>
              {METHODS.map(({ method: value, icon: Icon, title, text }) => (
                <label
                  key={value}
                  className={`${methodStyles.method} ${method === value ? methodStyles.methodChosen : ''}`}
                >
                  <input
                    type="radio"
                    name="verification-method"
                    value={value}
                    checked={method === value}
                    onChange={() => chooseMethod(value)}
                    className={methodStyles.radio}
                  />
                  <span className={methodStyles.methodIcon} aria-hidden="true">
                    <Icon size={20} />
                  </span>
                  <span className={methodStyles.methodBody}>
                    <span className={methodStyles.methodTitle}>{title}</span>
                    <span className={methodStyles.methodText}>{text}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            {chosen && (
              <div>
                <p className={methodStyles.hint}>
                  {chosen.kind === 'selfie'
                    ? 'Face the camera in good light, without sunglasses or a mask.'
                    : 'Fit the whole ID inside the frame, flat and in good light, with the text readable. Only our review team can see it.'}
                </p>
                <VerificationCameraCapture
                  key={chosen.kind}
                  mode={chosen.kind}
                  value={photo}
                  onChange={(file) => {
                    setPhoto(file);
                    setCaptureError(null);
                  }}
                  isSubmitting={isSubmitting}
                />
                {captureError && (
                  <p role="alert" className={methodStyles.error}>{captureError}</p>
                )}
              </div>
            )}

            <button type="submit" disabled={isSubmitting || !photo} style={{
              marginTop: '0.5rem',
              padding: '0.875rem',
              borderRadius: '9999px',
              background: 'var(--color-brand, var(--color-primary, #2563eb))',
              color: 'white',
              fontWeight: 600,
              fontSize: '1rem',
              border: 'none',
              cursor: (isSubmitting || !photo) ? 'not-allowed' : 'pointer',
              opacity: (isSubmitting || !photo) ? 0.5 : 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem'
            }}>
              {isSubmitting ? (
                <>
                  <span
                    className="spinner"
                    style={{ width: 18, height: 18, borderWidth: 2 }}
                    aria-hidden="true"
                  />
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
