import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest, getMediaUrl } from '../api/apiClient';
import { CheckCircle, XCircle, ExternalLink } from '../components/icons';

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
  const queryClient = useQueryClient();
  const [filterStatus, setFilterStatus] = useState<string>('PENDING');

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

  const handleAction = (id: string, status: string) => {
    mutation.mutate({ id, status });
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

              {req.status === 'PENDING' && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '0.5rem', paddingTop: '1.5rem', borderTop: '1px solid var(--color-border)' }}>
                  <button 
                    onClick={() => handleAction(req.id, 'REJECTED')}
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
                    onClick={() => handleAction(req.id, 'VERIFIED')}
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
    </div>
  );
};
