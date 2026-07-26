import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../api/apiClient';
import { Search, X } from 'lucide-react';

const UserAvatar: React.FC<{ user: any }> = ({ user }) => {
  const [imgError, setImgError] = useState(false);

  const getAvatarUrl = (src?: string) => {
    if (!src) return null;
    if (src.startsWith('http://localhost:4000')) {
      const backendHost = window.location.hostname;
      return src.replace('localhost', backendHost);
    }
    if (src.startsWith('/')) {
      return `${window.location.protocol}//${window.location.hostname}:4000${src}`;
    }
    return src;
  };

  const avatarUrl = getAvatarUrl(user.avatar);
  const initial = (user.displayName || user.username || 'U').charAt(0).toUpperCase();

  const gradients = [
    'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)',
    'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
    'linear-gradient(135deg, #10b981 0%, #047857 100%)',
    'linear-gradient(135deg, #f59e0b 0%, #b45309 100%)',
    'linear-gradient(135deg, #ec4899 0%, #be185d 100%)',
  ];
  const charCode = initial.charCodeAt(0) || 0;
  const bgGradient = gradients[charCode % gradients.length];

  if (avatarUrl && !imgError) {
    return (
      <img
        src={avatarUrl}
        alt={user.displayName || user.username}
        onError={() => setImgError(true)}
        style={{
          width: '36px',
          height: '36px',
          borderRadius: '50%',
          objectFit: 'cover',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          flexShrink: 0,
        }}
      />
    );
  }

  return (
    <div
      style={{
        width: '36px',
        height: '36px',
        borderRadius: '50%',
        background: bgGradient,
        color: '#ffffff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 800,
        fontSize: '0.85rem',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.25)',
        border: '1px solid rgba(255, 255, 255, 0.2)',
        flexShrink: 0,
      }}
    >
      {initial}
    </div>
  );
};

export const UsersPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['adminUsers', search, statusFilter, page],
    queryFn: () =>
      apiRequest(
        `/admin/users?search=${encodeURIComponent(search)}&accountStatus=${statusFilter}&page=${page}`,
      ),
  });

  const usersList = data?.data || [];

  const metrics = useMemo(() => {
    let active = 0;
    let verified = 0;
    let suspendedBanned = 0;

    usersList.forEach((u: any) => {
      if (u.accountStatus === 'ACTIVE') active++;
      if (u.accountStatus === 'SUSPENDED' || u.accountStatus === 'BANNED') suspendedBanned++;
      if (u.emailVerified) verified++;
    });

    return {
      total: data?.meta?.total || usersList.length,
      active,
      verified,
      suspendedBanned,
    };
  }, [usersList, data?.meta?.total]);

  const suspendMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/admin/users/${id}/suspend`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['adminUsers'] }),
  });

  const unsuspendMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/admin/users/${id}/unsuspend`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['adminUsers'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/admin/users/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['adminUsers'] }),
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/admin/users/${id}/restore`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['adminUsers'] }),
  });

  const verifyEmailMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/admin/users/${id}/verify-email`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['adminUsers'] }),
  });

  const resetCollegeMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/admin/users/${id}/reset-college`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['adminUsers'] }),
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', animation: 'fadeIn 0.3s ease' }}>
      {/* HEADER */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.2rem' }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.5px', color: '#fff' }}>
              User Directory & Accounts
            </h2>
            <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '2px 9px', borderRadius: '20px', background: 'rgba(99, 102, 241, 0.15)', color: '#a5b4fc', border: '1px solid rgba(99, 102, 241, 0.3)' }}>
              Live System
            </span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Inspect user profiles, manage suspensions, manually verify student emails, and reset college assignments.
          </p>
        </div>
      </div>

      {/* METRIC CARDS - SINGLE COMPACT ROW */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.85rem' }}>
        <div className="glass-panel" style={{ padding: '0.85rem 1.1rem', background: 'rgba(30, 41, 59, 0.5)', border: '1px solid rgba(255, 255, 255, 0.07)', borderRadius: '12px' }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total Accounts</div>
          <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#fff', marginTop: '0.1rem' }}>{metrics.total}</div>
        </div>

        <div className="glass-panel" style={{ padding: '0.85rem 1.1rem', background: 'rgba(30, 41, 59, 0.5)', border: '1px solid rgba(255, 255, 255, 0.07)', borderRadius: '12px' }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Active Accounts</div>
          <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#fff', marginTop: '0.1rem' }}>{metrics.active}</div>
        </div>

        <div className="glass-panel" style={{ padding: '0.85rem 1.1rem', background: 'rgba(30, 41, 59, 0.5)', border: '1px solid rgba(255, 255, 255, 0.07)', borderRadius: '12px' }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Verified Emails</div>
          <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#fff', marginTop: '0.1rem' }}>{metrics.verified}</div>
        </div>

        <div className="glass-panel" style={{ padding: '0.85rem 1.1rem', background: 'rgba(30, 41, 59, 0.5)', border: '1px solid rgba(255, 255, 255, 0.07)', borderRadius: '12px' }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Suspended / Banned</div>
          <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#fff', marginTop: '0.1rem' }}>{metrics.suspendedBanned}</div>
        </div>
      </div>

      {/* SEARCH AND STATUS FILTER TOOLBAR */}
      <div className="glass-panel" style={{ padding: '0.9rem 1.1rem', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', background: 'rgba(30, 41, 59, 0.4)', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: '240px' }}>
          <Search size={16} color="var(--text-dim)" style={{ position: 'absolute', left: '0.9rem', top: '50%', transform: 'translateY(-50%)' }} />
          <input
            type="text"
            placeholder="Search by display name, @username, or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%',
              padding: '0.6rem 0.9rem 0.6rem 2.4rem',
              background: 'rgba(15, 23, 42, 0.6)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: '9px',
              color: '#fff',
              fontSize: '0.85rem',
              outline: 'none',
            }}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* STATUS FILTER PILL BUTTONS */}
        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {[
            { id: '', label: 'All Statuses' },
            { id: 'ACTIVE', label: 'Active' },
            { id: 'SUSPENDED', label: 'Suspended' },
            { id: 'BANNED', label: 'Banned' },
          ].map((item) => {
            const isActive = statusFilter === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setStatusFilter(item.id)}
                style={{
                  padding: '0.45rem 0.8rem',
                  borderRadius: '7px',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  border: isActive ? '1px solid rgba(99, 102, 241, 0.5)' : '1px solid rgba(255, 255, 255, 0.08)',
                  background: isActive ? 'linear-gradient(135deg, rgba(99, 102, 241, 0.25) 0%, rgba(79, 70, 229, 0.25) 100%)' : 'rgba(15, 23, 42, 0.4)',
                  color: isActive ? '#a5b4fc' : 'var(--text-muted)',
                  transition: 'all 0.15s ease',
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* USER TABLE */}
      <div className="glass-panel" style={{ borderRadius: '12px', overflow: 'hidden', border: '1px solid rgba(255, 255, 255, 0.08)', background: 'rgba(30, 41, 59, 0.3)' }}>
        {isLoading ? (
          <div style={{ padding: '3.5rem 2rem', textAlign: 'center', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{ width: '26px', height: '26px', border: '3px solid rgba(99, 102, 241, 0.3)', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            <span>Loading user directory...</span>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="admin-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'rgba(15, 23, 42, 0.6)', textTransform: 'uppercase', fontSize: '0.7rem', letterSpacing: '0.6px', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '0.9rem 1.1rem', textAlign: 'left' }}>User Profile</th>
                  <th style={{ padding: '0.9rem 1.1rem', textAlign: 'left' }}>Email & Verification</th>
                  <th style={{ padding: '0.9rem 1.1rem', textAlign: 'center' }}>Activity Numbers</th>
                  <th style={{ padding: '0.9rem 1.1rem', textAlign: 'left' }}>College</th>
                  <th style={{ padding: '0.9rem 1.1rem', textAlign: 'center' }}>Status</th>
                  <th style={{ padding: '0.9rem 1.1rem', textAlign: 'left' }}>Joined</th>
                  <th style={{ padding: '0.9rem 1.1rem', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {usersList.map((u: any) => (
                  <tr key={u.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)', transition: 'background 0.15s ease' }}>
                    {/* USER PROFILE */}
                    <td style={{ padding: '0.9rem 1.1rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <UserAvatar user={u} />
                        <div>
                          <div style={{ fontWeight: 700, color: '#fff', fontSize: '0.9rem' }}>{u.displayName || u.username}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>@{u.username}</div>
                        </div>
                      </div>
                    </td>

                    {/* EMAIL */}
                    <td style={{ padding: '0.9rem 1.1rem' }}>
                      <div style={{ fontSize: '0.85rem', color: '#e2e8f0', fontWeight: 500 }}>{u.email}</div>
                      {u.emailVerified ? (
                        <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#34d399' }}>✓ Verified</span>
                      ) : (
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Unverified</span>
                      )}
                    </td>

                    {/* NUMBERS / STATS */}
                    <td style={{ padding: '0.9rem 1.1rem', textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', gap: '0.35rem', flexWrap: 'wrap', justifyContent: 'center' }}>
                        <span style={{ fontSize: '0.72rem', background: 'rgba(99, 102, 241, 0.15)', color: '#a5b4fc', padding: '2px 7px', borderRadius: '5px', border: '1px solid rgba(99, 102, 241, 0.3)', fontWeight: 600 }}>
                          {u._count?.posts || 0} posts
                        </span>
                        <span style={{ fontSize: '0.72rem', background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', padding: '2px 7px', borderRadius: '5px', border: '1px solid rgba(16, 185, 129, 0.3)', fontWeight: 600 }}>
                          {u._count?.followers || 0} followers
                        </span>
                      </div>
                    </td>

                    {/* COLLEGE */}
                    <td style={{ padding: '0.9rem 1.1rem' }}>
                      {u.college ? (
                        <span style={{ fontSize: '0.82rem', color: '#818cf8', fontWeight: 600 }}>{u.college.name}</span>
                      ) : (
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>None</span>
                      )}
                    </td>

                    {/* STATUS */}
                    <td style={{ padding: '0.9rem 1.1rem', textAlign: 'center' }}>
                      {u.accountStatus === 'ACTIVE' ? (
                        <span style={{ padding: '3px 9px', borderRadius: '20px', fontSize: '0.7rem', fontWeight: 700, background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                          ACTIVE
                        </span>
                      ) : u.accountStatus === 'SUSPENDED' ? (
                        <span style={{ padding: '3px 9px', borderRadius: '20px', fontSize: '0.7rem', fontWeight: 700, background: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24', border: '1px solid rgba(245, 158, 11, 0.3)' }}>
                          SUSPENDED
                        </span>
                      ) : (
                        <span style={{ padding: '3px 9px', borderRadius: '20px', fontSize: '0.7rem', fontWeight: 700, background: 'rgba(239, 68, 68, 0.15)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                          BANNED
                        </span>
                      )}
                    </td>

                    {/* JOINED */}
                    <td style={{ padding: '0.9rem 1.1rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>

                    {/* ACTIONS */}
                    <td style={{ padding: '0.9rem 1.1rem', textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        {u.accountStatus === 'ACTIVE' ? (
                          <button
                            onClick={() => suspendMutation.mutate(u.id)}
                            disabled={suspendMutation.isPending}
                            style={{ padding: '0.35rem 0.7rem', borderRadius: '7px', fontSize: '0.75rem', fontWeight: 600, background: 'rgba(239, 68, 68, 0.12)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.25)', cursor: 'pointer' }}
                          >
                            Suspend
                          </button>
                        ) : (
                          <button
                            onClick={() => unsuspendMutation.mutate(u.id)}
                            disabled={unsuspendMutation.isPending}
                            style={{ padding: '0.35rem 0.7rem', borderRadius: '7px', fontSize: '0.75rem', fontWeight: 600, background: 'rgba(16, 185, 129, 0.12)', color: '#34d399', border: '1px solid rgba(16, 185, 129, 0.25)', cursor: 'pointer' }}
                          >
                            Unsuspend
                          </button>
                        )}

                        {!u.emailVerified && (
                          <button
                            onClick={() => verifyEmailMutation.mutate(u.id)}
                            disabled={verifyEmailMutation.isPending}
                            style={{ padding: '0.35rem 0.7rem', borderRadius: '7px', fontSize: '0.75rem', fontWeight: 600, background: 'rgba(16, 185, 129, 0.12)', color: '#34d399', border: '1px solid rgba(16, 185, 129, 0.25)', cursor: 'pointer' }}
                          >
                            Verify
                          </button>
                        )}

                        {u.collegeId && (
                          <button
                            onClick={() => resetCollegeMutation.mutate(u.id)}
                            disabled={resetCollegeMutation.isPending}
                            style={{ padding: '0.35rem 0.7rem', borderRadius: '7px', fontSize: '0.75rem', fontWeight: 600, background: 'rgba(245, 158, 11, 0.12)', color: '#fbbf24', border: '1px solid rgba(245, 158, 11, 0.25)', cursor: 'pointer' }}
                          >
                            Reset College
                          </button>
                        )}

                        {u.accountStatus === 'BANNED' ? (
                          <button
                            onClick={() => restoreMutation.mutate(u.id)}
                            disabled={restoreMutation.isPending}
                            style={{ padding: '0.35rem 0.7rem', borderRadius: '7px', fontSize: '0.75rem', fontWeight: 600, background: 'rgba(16, 185, 129, 0.12)', color: '#34d399', border: '1px solid rgba(16, 185, 129, 0.25)', cursor: 'pointer' }}
                          >
                            Restore
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              if (confirm(`Soft delete account @${u.username}?`)) {
                                deleteMutation.mutate(u.id);
                              }
                            }}
                            disabled={deleteMutation.isPending}
                            style={{ padding: '0.35rem 0.7rem', borderRadius: '7px', fontSize: '0.75rem', fontWeight: 600, background: 'rgba(239, 68, 68, 0.12)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.25)', cursor: 'pointer' }}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}

                {usersList.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem 1rem' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontWeight: 600, color: '#fff' }}>No users found</span>
                        <span style={{ fontSize: '0.78rem' }}>Try adjusting your search query or status filter.</span>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
