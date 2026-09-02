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
  const size = { width: '48px', height: '48px', borderRadius: '50%', flexShrink: 0 } as const;

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
    <div style={{ ...size, background: bgColor, color: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>
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
  // list on every load, so the queue always rendered "All Caught Up".
  const requests = data?.requests || [];

  return (
    <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto', color: 'var(--color-text-main)' }}>
      <header style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 600, color: 'var(--color-text-white)', marginBottom: '0.25rem' }}>
            ID Verification
          </h1>
          <p style={{ color: 'var(--color-text-light)', fontSize: '0.9rem' }}>
            Review user identity verification requests
          </p>
        </div>
        
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {['ALL', 'PENDING', 'VERIFIED', 'REJECTED'].map(status => (
            <button
              key={status}
              onClick={() => setFilterStatus(status)}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '6px',
                border: '1px solid',
                borderColor: filterStatus === status ? 'var(--color-brand)' : 'var(--color-border)',
                background: filterStatus === status ? 'var(--color-brand-alpha)' : 'var(--color-bg-panel)',
                color: filterStatus === status ? 'var(--color-brand)' : 'var(--color-text-light)',
                fontSize: '0.875rem',
                cursor: 'pointer'
              }}
            >
              {status}
            </button>
          ))}
        </div>
      </header>

      {isLoading ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-text-light)' }}>Loading requests...</div>
      ) : requests.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', background: 'var(--color-bg-panel)', borderRadius: '12px', border: '1px solid var(--color-border)' }}>
          <CheckCircle size={48} style={{ color: 'var(--color-success)', margin: '0 auto 1rem', opacity: 0.5 }} />
          <h3 style={{ fontSize: '1.1rem', color: 'var(--color-text-white)', marginBottom: '0.5rem' }}>All Caught Up</h3>
          <p style={{ color: 'var(--color-text-light)', fontSize: '0.9rem' }}>There are no verification requests matching this filter.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '1.5rem' }}>
          {requests.map((req: any) => (
            <div key={req.id} style={{ 
              background: 'var(--color-bg-panel)', 
              borderRadius: '12px', 
              border: '1px solid var(--color-border)',
              padding: '1.5rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.5rem'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  {/* The API selects `avatar` (a storage path), not `avatarUrl`,
                      so the old read was always undefined and every reviewer saw a
                      third-party generated initial instead of the real photo. */}
                  <ReviewerAvatar user={req.user} />
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--color-text-white)' }}>
                      {req.user.displayName} <span style={{ color: 'var(--color-text-light)', fontSize: '0.9rem' }}>@{req.user.username}</span>
                    </h3>
                    <div style={{ fontSize: '0.85rem', color: 'var(--color-text-light)', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span>{req.user.email}</span>
                      <span>•</span>
                      <span>Requested: {new Date(req.createdAt).toLocaleString()}</span>
                      {req.attemptNumber != null && (
                        <>
                          <span>•</span>
                          <span>Attempt {req.attemptNumber}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div>
                  <span style={{ 
                    padding: '0.25rem 0.75rem', 
                    borderRadius: '9999px', 
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    backgroundColor: req.status === 'PENDING' ? 'rgba(234, 179, 8, 0.2)' : req.status === 'VERIFIED' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                    color: req.status === 'PENDING' ? '#eab308' : req.status === 'VERIFIED' ? '#22c55e' : '#ef4444'
                  }}>
                    {req.status}
                  </span>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.85rem', color: 'var(--color-text-light)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>College ID Card</span>
                  <div style={{ 
                    background: 'var(--color-bg-main)', 
                    borderRadius: '8px', 
                    overflow: 'hidden',
                    border: '1px solid var(--color-border)',
                    height: '240px',
                    position: 'relative'
                  }}>
                    {req.idCardMedia?.url ? (
                      <a href={req.idCardMedia.url} target="_blank" rel="noopener noreferrer" style={{ display: 'block', height: '100%' }}>
                        <img src={req.idCardMedia.url} alt="ID Card" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                        <div style={{ position: 'absolute', top: '0.5rem', right: '0.5rem', background: 'rgba(0,0,0,0.6)', padding: '0.25rem', borderRadius: '4px' }}>
                          <ExternalLink size={16} color="white" />
                        </div>
                      </a>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-text-light)' }}>No image</div>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.85rem', color: 'var(--color-text-light)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Live Selfie</span>
                  <div style={{ 
                    background: 'var(--color-bg-main)', 
                    borderRadius: '8px', 
                    overflow: 'hidden',
                    border: '1px solid var(--color-border)',
                    height: '240px',
                    position: 'relative'
                  }}>
                    {req.selfieMedia?.url ? (
                      <a href={req.selfieMedia.url} target="_blank" rel="noopener noreferrer" style={{ display: 'block', height: '100%' }}>
                        <img src={req.selfieMedia.url} alt="Selfie" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                        <div style={{ position: 'absolute', top: '0.5rem', right: '0.5rem', background: 'rgba(0,0,0,0.6)', padding: '0.25rem', borderRadius: '4px' }}>
                          <ExternalLink size={16} color="white" />
                        </div>
                      </a>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-text-light)' }}>No image</div>
                    )}
                  </div>
                </div>
              </div>

              {req.previousAttempts?.length > 0 && (
                <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid var(--color-border)' }}>
                  <p style={{ margin: '0 0 0.6rem', fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-light)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                    Previous attempts
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {req.previousAttempts.map((prev: any) => (
                      <div key={prev.id} style={{ display: 'flex', gap: '0.75rem', alignItems: 'baseline', fontSize: '0.825rem' }}>
                        <span style={{ color: 'var(--color-text-light)', minWidth: '5.5rem' }}>
                          Attempt {prev.attemptNumber}
                        </span>
                        <span style={{
                          color: prev.status === 'VERIFIED' ? '#22c55e' : prev.status === 'PENDING' ? '#eab308' : '#ef4444',
                          fontWeight: 500, minWidth: '5rem',
                        }}>
                          {prev.status}
                        </span>
                        <span style={{ color: 'var(--color-text-main)', flex: 1 }}>
                          {prev.rejectionReason || <span style={{ color: 'var(--color-text-light)' }}>No reason recorded</span>}
                        </span>
                        <span style={{ color: 'var(--color-text-light)', whiteSpace: 'nowrap' }}>
                          {prev.reviewedAt ? new Date(prev.reviewedAt).toLocaleDateString() : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {req.status === 'PENDING' && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '0.5rem', paddingTop: '1.5rem', borderTop: '1px solid var(--color-border)' }}>
                  <button 
                    onClick={() => { setRejectReason(''); setRejecting(req); }}
                    disabled={mutation.isPending}
                    style={{ 
                      padding: '0.6rem 1.25rem', 
                      borderRadius: '6px', 
                      background: 'rgba(239, 68, 68, 0.1)', 
                      color: '#ef4444', 
                      border: '1px solid rgba(239, 68, 68, 0.2)',
                      cursor: 'pointer',
                      fontWeight: 500,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem'
                    }}
                  >
                    <XCircle size={18} /> Reject
                  </button>
                  <button 
                    onClick={() => handleAction(req.id, 'VERIFIED', req.user?.username)}
                    disabled={mutation.isPending}
                    style={{ 
                      padding: '0.6rem 1.25rem', 
                      borderRadius: '6px', 
                      background: 'var(--color-success)', 
                      color: 'white', 
                      border: 'none',
                      cursor: 'pointer',
                      fontWeight: 500,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem'
                    }}
                  >
                    <CheckCircle size={18} /> Approve
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
          onClick={closeRejectModal}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '1rem',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--color-bg-card, #16181d)',
              border: '1px solid var(--color-border)',
              borderRadius: '12px',
              padding: '1.5rem',
              width: '100%', maxWidth: '520px',
            }}
          >
            <h2 id="reject-title" style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--color-text-white)', marginBottom: '0.35rem' }}>
              Reject verification
            </h2>
            <p style={{ color: 'var(--color-text-light)', fontSize: '0.875rem', marginBottom: '1.25rem' }}>
              {rejecting.user?.displayName || rejecting.user?.username || 'This user'} will see this
              reason on their Account Verification screen, so write what they need to correct.
            </p>

            <label htmlFor="reject-reason" style={{ display: 'block', fontSize: '0.8rem', fontWeight: 500, marginBottom: '0.4rem', color: 'var(--color-text-main)' }}>
              Reason for rejection <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <textarea
              id="reject-reason"
              autoFocus
              value={rejectReason}
              maxLength={REASON_MAX}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. The college ID photo is too blurry to read the name and enrolment number."
              rows={4}
              style={{
                width: '100%', resize: 'vertical', padding: '0.75rem',
                borderRadius: '8px', background: 'var(--color-bg-input, #0f1115)',
                color: 'var(--color-text-main)',
                border: '1px solid var(--color-border)',
                fontFamily: 'inherit', fontSize: '0.875rem',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.4rem', fontSize: '0.75rem', color: 'var(--color-text-light)' }}>
              <span>{trimmedReason ? '\u00A0' : 'A reason is required.'}</span>
              <span>{rejectReason.length}/{REASON_MAX}</span>
            </div>

            {mutation.isError && (
              <p role="alert" style={{ color: '#ef4444', fontSize: '0.8rem', marginTop: '0.75rem' }}>
                {(mutation.error as Error)?.message || 'Could not reject this request.'}
              </p>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
              <button
                onClick={closeRejectModal}
                disabled={mutation.isPending}
                style={{
                  padding: '0.6rem 1.1rem', borderRadius: '6px',
                  background: 'transparent', color: 'var(--color-text-main)',
                  border: '1px solid var(--color-border)', cursor: 'pointer', fontWeight: 500,
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmRejection}
                disabled={!trimmedReason || mutation.isPending}
                style={{
                  padding: '0.6rem 1.1rem', borderRadius: '6px',
                  background: trimmedReason ? '#ef4444' : 'rgba(239, 68, 68, 0.35)',
                  color: 'white', border: 'none', fontWeight: 500,
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
