import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest, getMediaUrl } from '../api/apiClient';
import { CheckCircle, XCircle, ExternalLink } from '../components/icons';
import { useConfirm } from '../components/ConfirmProvider';

/** Same avatar treatment as the Users and Campus Reps tables. */
const ReviewerAvatar: React.FC<{ user: any }> = ({ user }) => {
  const [imgError, setImgError] = useState(false);
  const avatarUrl = getMediaUrl(user?.avatar);
  const initial = (user?.displayName || user?.username || 'U').charAt(0).toUpperCase();
  const colors = ['#2563EB', '#7C3AED', '#10B981', '#F59E0B', '#EC4899'];
  const bgColor = colors[(initial.charCodeAt(0) || 0) % colors.length];
  const size = { width: '42px', height: '42px', borderRadius: '50%', flexShrink: 0 } as const;

  if (avatarUrl && !imgError) {
    return (
      <img
        src={avatarUrl}
        alt={user?.displayName || user?.username || 'Avatar'}
        onError={() => setImgError(true)}
        style={{ ...size, objectFit: 'cover', border: '1px solid var(--color-border)' }}
      />
    );
  }
  return (
    <div style={{ ...size, background: bgColor, color: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.95rem' }}>
      {initial}
    </div>
  );
};

export const VerificationPage: React.FC = () => {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [filterStatus, setFilterStatus] = useState<string>('PENDING');
  /**
   * The request awaiting a rejection reason.
   *
   * Reject used to fire the mutation straight away with no `adminNotes`, so the
   * backend dutifully stored `rejectionReason: null` and the user was told only
   * that they had been rejected — never why. A reason is now required before
   * the call is made at all.
   */
  const [rejecting, setRejecting] = useState<any | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['adminVerificationRequests', filterStatus],
    queryFn: () => {
      const url = filterStatus === 'ALL' 
        ? '/admin/verification/requests' 
        : `/admin/verification/requests?status=${filterStatus}`;
      return apiRequest(url);
    },
  });

  const mutation = useMutation({
    mutationFn: ({ id, status, adminNotes }: { id: string, status: string, adminNotes?: string }) => 
      apiRequest(`/admin/verification/requests/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status, adminNotes }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminVerificationRequests'] });
    },
  });

  /**
   * Approving is confirmed; rejecting is not routed through the shared dialog.
   *
   * Rejection already has its own modal because it COLLECTS something - the
   * reason is required and is shown to the student - and a generic confirmation
   * cannot capture required input. Replacing it would have meant either losing
   * the reason or bolting a text field onto a dialog whose whole value is that
   * it looks the same everywhere.
   *
   * Approval had nothing at all, and it is not a small act: VERIFIED is the
   * status that admits an account to messaging, campus surfaces and every
   * share/invite selector.
   */
  const handleAction = (id: string, status: string, username?: string) => {
    confirm({
      title: username ? `Approve verification for @${username}?` : 'Approve this verification?',
      description: 'The account is marked verified.',
      consequences: [
        'They gain access to messaging, campus surfaces and share or invite lists.',
      ],
      severity: 'moderate',
      confirmLabel: 'Approve',
      onConfirm: () => mutation.mutateAsync({ id, status }),
    });
  };

  const REASON_MAX = 500; // matches VerificationRequest.rejectionReason
  const trimmedReason = rejectReason.trim();

  const closeRejectModal = () => {
    setRejecting(null);
    setRejectReason('');
  };

  const confirmRejection = () => {
    if (!rejecting || !trimmedReason) return;
    mutation.mutate(
      { id: rejecting.id, status: 'REJECTED', adminNotes: trimmedReason },
      { onSuccess: closeRejectModal },
    );
  };

  // `GET /admin/verification/requests` responds `{ total, requests }` — there is
  // no envelope around it. Reading `data.data.requests` silently yielded an empty
  const requests = data?.requests || [];

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 className="page-title">ID Verification</h2>
          <p className="page-subtitle">Review user identity verification requests.</p>
        </div>

        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
          {['ALL', 'PENDING', 'VERIFIED', 'REJECTED'].map((status) => {
            const isActive = filterStatus === status;
            return (
              <button
                key={status}
                onClick={() => setFilterStatus(status)}
                className={isActive ? 'btn-primary' : 'btn-secondary'}
                style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem' }}
              >
                {status}
              </button>
            );
          })}
        </div>
      </div>

      {isLoading ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-text-dim)', fontSize: '0.85rem' }}>
          Loading requests...
        </div>
      ) : requests.length === 0 ? (
        <div className="glass-panel" style={{ padding: '3rem 1.5rem', textAlign: 'center' }}>
          <CheckCircle size={44} style={{ color: 'var(--color-success)', margin: '0 auto 0.75rem', opacity: 0.6 }} />
          <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--color-text-main)', marginBottom: '0.35rem' }}>
            All Caught Up
          </h3>
          <p style={{ color: 'var(--color-text-light)', fontSize: '0.85rem' }}>
            There are no verification requests matching this filter.
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '1.25rem' }}>
          {requests.map((req: any) => (
            <div
              key={req.id}
              className="glass-panel verification-card"
              style={{
                padding: '1.25rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '1.15rem',
              }}
            >
              {/* User Identity Header */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', width: '100%' }}>
                <ReviewerAvatar user={req.user} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.2rem' }}>
                    <h3 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 700, color: 'var(--color-text-main)', wordBreak: 'break-word', lineHeight: 1.3 }}>
                      {req.user?.displayName || req.user?.username}{' '}
                      <span style={{ color: 'var(--color-text-light)', fontSize: '0.8rem', fontWeight: 500 }}>
                        @{req.user?.username}
                      </span>
                    </h3>
                    <span
                      className={`badge ${
                        req.status === 'PENDING'
                          ? 'badge-warning'
                          : req.status === 'VERIFIED'
                          ? 'badge-success'
                          : 'badge-danger'
                      }`}
                      style={{ flexShrink: 0, marginTop: '1px' }}
                    >
                      {req.status}
                    </span>
                  </div>

                  <div style={{ fontSize: '0.76rem', color: 'var(--color-text-muted)', wordBreak: 'break-all', marginBottom: '0.25rem' }}>
                    {req.user?.email}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap', fontSize: '0.73rem', color: 'var(--color-text-light)' }}>
                    <span>Requested: {new Date(req.createdAt).toLocaleDateString()} {new Date(req.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    {req.attemptNumber != null && (
                      <span style={{ background: 'var(--color-bg-soft)', border: '1px solid var(--color-border)', borderRadius: '4px', padding: '1px 6px', fontSize: '0.68rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
                        Attempt {req.attemptNumber}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Media Comparison (ID Card & Live Selfie) */}
              <div className="verification-media-grid">
                <div className="verification-media-card">
                  <div className="verification-media-header">
                    <span className="verification-media-label">College ID Card</span>
                    {req.idCardMedia?.url && (
                      <a
                        href={req.idCardMedia.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="verification-media-ext-link"
                        title="Open full resolution in new tab"
                      >
                        <ExternalLink size={12} />
                        <span>Open</span>
                      </a>
                    )}
                  </div>
                  <div className="verification-media-frame">
                    {req.idCardMedia?.url ? (
                      <a href={req.idCardMedia.url} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
                        <img src={req.idCardMedia.url} alt="College ID Card" />
                      </a>
                    ) : (
                      <div className="verification-media-empty">No ID card uploaded</div>
                    )}
                  </div>
                </div>

                <div className="verification-media-card">
                  <div className="verification-media-header">
                    <span className="verification-media-label">Live Selfie</span>
                    {req.selfieMedia?.url && (
                      <a
                        href={req.selfieMedia.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="verification-media-ext-link"
                        title="Open full resolution in new tab"
                      >
                        <ExternalLink size={12} />
                        <span>Open</span>
                      </a>
                    )}
                  </div>
                  <div className="verification-media-frame">
                    {req.selfieMedia?.url ? (
                      <a href={req.selfieMedia.url} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
                        <img src={req.selfieMedia.url} alt="Live Selfie" />
                      </a>
                    ) : (
                      <div className="verification-media-empty">No selfie uploaded</div>
                    )}
                  </div>
                </div>
              </div>

              {req.previousAttempts?.length > 0 && (
                <div style={{ marginTop: '0.5rem', paddingTop: '0.85rem', borderTop: '1px solid var(--color-border)' }}>
                  <p style={{ margin: '0 0 0.5rem', fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-text-light)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                    Previous attempts ({req.previousAttempts.length})
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {req.previousAttempts.map((prev: any) => (
                      <div
                        key={prev.id}
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: '0.4rem 0.75rem',
                          alignItems: 'center',
                          fontSize: '0.8rem',
                          background: 'var(--color-bg-alt)',
                          padding: '0.45rem 0.65rem',
                          borderRadius: 'var(--radius-sm)',
                        }}
                      >
                        <span style={{ color: 'var(--color-text-light)', fontWeight: 600 }}>
                          Attempt {prev.attemptNumber}
                        </span>
                        <span
                          className={`badge ${
                            prev.status === 'VERIFIED'
                              ? 'badge-success'
                              : prev.status === 'PENDING'
                              ? 'badge-warning'
                              : 'badge-danger'
                          }`}
                          style={{ fontSize: '0.68rem' }}
                        >
                          {prev.status}
                        </span>
                        <span style={{ color: 'var(--color-text-main)', flex: '1 1 180px' }}>
                          {prev.rejectionReason || <span style={{ color: 'var(--color-text-dim)' }}>No reason recorded</span>}
                        </span>
                        <span style={{ color: 'var(--color-text-dim)', fontSize: '0.74rem', whiteSpace: 'nowrap' }}>
                          {prev.reviewedAt ? new Date(prev.reviewedAt).toLocaleDateString() : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {req.status === 'PENDING' && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.65rem', marginTop: '0.5rem', paddingTop: '1rem', borderTop: '1px solid var(--color-border)', flexWrap: 'wrap' }}>
                  <button 
                    onClick={() => { setRejectReason(''); setRejecting(req); }}
                    disabled={mutation.isPending}
                    className="btn-secondary"
                    style={{ color: 'var(--color-danger-hover)', minWidth: '110px', justifyContent: 'center' }}
                  >
                    <XCircle size={15} />
                    <span>Reject</span>
                  </button>
                  <button 
                    onClick={() => handleAction(req.id, 'VERIFIED', req.user?.username)}
                    disabled={mutation.isPending}
                    className="btn-primary"
                    style={{ background: 'var(--color-success)', borderColor: 'var(--color-success)', minWidth: '110px', justifyContent: 'center' }}
                  >
                    <CheckCircle size={15} />
                    <span>Approve</span>
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {rejecting && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="reject-title"
          className="modal-backdrop"
          onClick={closeRejectModal}
        >
          <div
            className="modal-content"
            onClick={(e) => e.stopPropagation()}
            style={{ padding: '1.5rem', maxWidth: '520px', width: '100%' }}
          >
            <h2 id="reject-title" style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--color-text-main)', marginBottom: '0.35rem' }}>
              Reject verification
            </h2>
            <p style={{ color: 'var(--color-text-light)', fontSize: '0.82rem', marginBottom: '1.25rem' }}>
              {rejecting.user?.displayName || rejecting.user?.username || 'This user'} will see this
              reason on their Account Verification screen, so write what they need to correct.
            </p>

            <label htmlFor="reject-reason" style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: '0.4rem', color: 'var(--color-text-muted)' }}>
              Reason for rejection <span style={{ color: 'var(--color-danger)' }}>*</span>
            </label>
            <textarea
              id="reject-reason"
              autoFocus
              value={rejectReason}
              maxLength={REASON_MAX}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. The college ID photo is too blurry to read the name and enrolment number."
              rows={4}
              className="input-control"
              style={{ resize: 'vertical' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.4rem', fontSize: '0.74rem', color: 'var(--color-text-dim)' }}>
              <span>{trimmedReason ? '\u00A0' : 'A reason is required.'}</span>
              <span>{rejectReason.length}/{REASON_MAX}</span>
            </div>

            {mutation.isError && (
              <p role="alert" style={{ color: 'var(--color-danger)', fontSize: '0.8rem', marginTop: '0.75rem' }}>
                {(mutation.error as Error)?.message || 'Could not reject this request.'}
              </p>
            )}

            <div className="modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '1.25rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={closeRejectModal}
                disabled={mutation.isPending}
                className="btn-secondary"
                style={{ minWidth: '90px', justifyContent: 'center' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmRejection}
                disabled={!trimmedReason || mutation.isPending}
                className="btn-danger"
                style={{
                  minWidth: '140px', justifyContent: 'center',
                  opacity: trimmedReason && !mutation.isPending ? 1 : 0.5,
                  cursor: trimmedReason && !mutation.isPending ? 'pointer' : 'not-allowed',
                }}
              >
                {mutation.isPending ? 'Rejecting…' : 'Confirm rejection'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
