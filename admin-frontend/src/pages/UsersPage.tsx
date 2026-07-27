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

  const colors = ['#2563EB', '#7C3AED', '#10B981', '#F59E0B', '#EC4899'];
  const charCode = initial.charCodeAt(0) || 0;
  const bgColor = colors[charCode % colors.length];

  if (avatarUrl && !imgError) {
    return (
      <img
        src={avatarUrl}
        alt={user.displayName || user.username}
        onError={() => setImgError(true)}
        style={{
          width: '32px',
          height: '32px',
          borderRadius: '50%',
          objectFit: 'cover',
          border: '1px solid var(--color-border)',
          flexShrink: 0,
        }}
      />
    );
  }

  return (
    <div
      style={{
        width: '32px',
        height: '32px',
        borderRadius: '50%',
        background: bgColor,
        color: '#FFFFFF',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        fontSize: '0.8rem',
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
    <div>
      <div className="page-header">
        <div>
          <h2 className="page-title">Users & Accounts</h2>
          <p className="page-subtitle">User profiles, email verifications, and account statuses.</p>
        </div>
      </div>

      {/* METRICS ROW */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.85rem', marginBottom: '1.25rem' }}>
        <div className="glass-panel" style={{ padding: '0.85rem 1rem' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-light)', textTransform: 'uppercase' }}>Total Users</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--color-text-main)', marginTop: '0.15rem' }}>{metrics.total}</div>
        </div>

        <div className="glass-panel" style={{ padding: '0.85rem 1rem' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-light)', textTransform: 'uppercase' }}>Active</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--color-text-main)', marginTop: '0.15rem' }}>{metrics.active}</div>
        </div>

        <div className="glass-panel" style={{ padding: '0.85rem 1rem' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-light)', textTransform: 'uppercase' }}>Verified Emails</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--color-text-main)', marginTop: '0.15rem' }}>{metrics.verified}</div>
        </div>

        <div className="glass-panel" style={{ padding: '0.85rem 1rem' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-light)', textTransform: 'uppercase' }}>Suspended / Banned</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--color-text-main)', marginTop: '0.15rem' }}>{metrics.suspendedBanned}</div>
        </div>
      </div>

      {/* SEARCH AND FILTERS */}
      <div className="glass-panel" style={{ padding: '0.85rem 1rem', marginBottom: '1.25rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: '220px' }}>
          <Search size={15} color="var(--color-text-dim)" style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)' }} />
          <input
            type="text"
            placeholder="Search name, @username, or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-control"
            style={{ paddingLeft: '2.2rem' }}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              style={{ position: 'absolute', right: '0.65rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--color-text-dim)', cursor: 'pointer' }}
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
          {[
            { id: '', label: 'All' },
            { id: 'ACTIVE', label: 'Active' },
            { id: 'SUSPENDED', label: 'Suspended' },
            { id: 'BANNED', label: 'Banned' },
          ].map((item) => {
            const isActive = statusFilter === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setStatusFilter(item.id)}
                className={isActive ? 'btn-primary' : 'btn-secondary'}
                style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem' }}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* TABLE */}
      <div className="glass-panel" style={{ overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-text-dim)', fontSize: '0.85rem' }}>
            Loading users...
          </div>
        ) : (
          <div className="table-responsive">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Email</th>
                  <th>College</th>
                  <th style={{ textAlign: 'center' }}>Status</th>
                  <th>Joined</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {usersList.map((u: any) => (
                  <tr key={u.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                        <UserAvatar user={u} />
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--color-text-main)' }}>{u.displayName || u.username}</div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--color-text-light)' }}>@{u.username}</div>
                        </div>
                      </div>
                    </td>

                    <td>
                      <div style={{ fontSize: '0.82rem', color: 'var(--color-text-main)', fontWeight: 500 }}>{u.email}</div>
                      {u.emailVerified ? (
                        <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--color-success)' }}>✓ Verified</span>
                      ) : (
                        <span style={{ fontSize: '0.7rem', color: 'var(--color-text-dim)' }}>Unverified</span>
                      )}
                    </td>

                    <td style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
                      {u.college?.name || '—'}
                    </td>

                    <td style={{ textAlign: 'center' }}>
                      {u.accountStatus === 'ACTIVE' ? (
                        <span className="badge badge-success">Active</span>
                      ) : u.accountStatus === 'SUSPENDED' ? (
                        <span className="badge badge-warning">Suspended</span>
                      ) : (
                        <span className="badge badge-danger">Banned</span>
                      )}
                    </td>

                    <td style={{ fontSize: '0.8rem', color: 'var(--color-text-light)' }}>
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>

                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        {u.accountStatus === 'ACTIVE' ? (
                          <button
                            onClick={() => suspendMutation.mutate(u.id)}
                            className="btn-secondary"
                            style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem', color: 'var(--color-danger-hover)' }}
                          >
                            Suspend
                          </button>
                        ) : (
                          <button
                            onClick={() => unsuspendMutation.mutate(u.id)}
                            className="btn-secondary"
                            style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem', color: 'var(--color-success)' }}
                          >
                            Unsuspend
                          </button>
                        )}

                        {!u.emailVerified && (
                          <button
                            onClick={() => verifyEmailMutation.mutate(u.id)}
                            className="btn-secondary"
                            style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem', color: 'var(--color-primary)' }}
                          >
                            Verify
                          </button>
                        )}

                        {u.collegeId && (
                          <button
                            onClick={() => resetCollegeMutation.mutate(u.id)}
                            className="btn-secondary"
                            style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                          >
                            Reset College
                          </button>
                        )}

                        {u.accountStatus === 'BANNED' ? (
                          <button
                            onClick={() => restoreMutation.mutate(u.id)}
                            className="btn-secondary"
                            style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                          >
                            Restore
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              if (confirm(`Delete user @${u.username}?`)) {
                                deleteMutation.mutate(u.id);
                              }
                            }}
                            className="btn-danger"
                            style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
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
                    <td colSpan={6} style={{ textAlign: 'center', color: 'var(--color-text-dim)', padding: '2.5rem 1rem' }}>
                      No users match your filters.
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
