import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest, getMediaUrl } from '../api/apiClient';
import { Search, X } from '../components/icons';
import { useDebounced } from '../hooks/useDebounced';
import { Pagination } from '../components/Pagination';
import { useConfirm } from '../components/ConfirmProvider';

const UserAvatar: React.FC<{ user: any }> = ({ user }) => {
  const [imgError, setImgError] = useState(false);

  const avatarUrl = getMediaUrl(user.avatar);
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

/**
 * Identity-verification state, shown for every user.
 *
 * This replaces a flag that tracked email confirmation separately. Supabase
 * already refuses to create an account without a confirmed email, so that flag
 * was true of everyone by construction and only ever read `false` because
 * nothing populated it. The status below is the one that actually gates
 * messaging and communities, so it is the one worth showing here.
 */
const VerificationLabel: React.FC<{ status?: string }> = ({ status }) => {
  const styles: Record<string, { label: string; color: string; weight: number }> = {
    VERIFIED: { label: '\u2713 Verified', color: 'var(--color-success)', weight: 600 },
    PENDING: { label: 'Pending review', color: 'var(--color-warning)', weight: 600 },
    REJECTED: { label: 'Rejected', color: 'var(--color-danger)', weight: 600 },
    RESUBMISSION_REQUIRED: { label: 'Resubmission needed', color: 'var(--color-warning)', weight: 600 },
  };
  const shown = styles[status ?? ''] ?? {
    label: 'Unverified',
    color: 'var(--color-text-dim)',
    weight: 400,
  };

  return (
    <span style={{ fontSize: '0.7rem', fontWeight: shown.weight, color: shown.color }}>
      {shown.label}
    </span>
  );
};

export const UsersPage: React.FC = () => {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  // The query is keyed on this, so debouncing is what stops one request per
  // keystroke from being sent to the users endpoint.
  const debouncedSearch = useDebounced(search.trim(), 300);
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);

  // Any change to what is being filtered invalidates the current page number.
  useEffect(() => { setPage(1); }, [debouncedSearch, statusFilter]);

  const { data, isLoading } = useQuery({
    queryKey: ['adminUsers', debouncedSearch, statusFilter, page],
    queryFn: () =>
      apiRequest(
        `/admin/users?search=${encodeURIComponent(debouncedSearch)}&accountStatus=${statusFilter}&page=${page}`,
      ),
  });

  const usersList = data?.data || [];

  /**
   * Counts for the whole filtered set, served in `meta.counts`.
   *
   * These used to be tallied from `usersList`, which is one page — so the cards
   * described the 20 rows on screen while being labelled as totals. The
   * fallbacks keep the row rendering during the first load.
   */
  const metrics = useMemo(() => {
    const counts = data?.meta?.counts;
    return {
      total: data?.meta?.total ?? usersList.length,
      active: counts?.active ?? 0,
      verified: counts?.verified ?? 0,
      suspendedBanned: counts?.suspendedOrBanned ?? 0,
    };
  }, [usersList.length, data?.meta]);

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

  const resetCollegeMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/admin/users/${id}/reset-college`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['adminUsers'] }),
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 className="page-title">Users & Accounts</h2>
          <p className="page-subtitle">User profiles, identity verification, and account statuses.</p>
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
          <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-light)', textTransform: 'uppercase' }}>Verified Students</div>
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
                      <VerificationLabel status={u.verificationStatus} />
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
                            onClick={() => confirm({
                              title: `Suspend @${u.username}?`,
                              description: 'They will be signed out and blocked from using Meetifyy until an admin lifts the suspension.',
                              consequences: [
                                'Their posts and messages stay visible to others.',
                                'They can be unsuspended at any time.',
                              ],
                              severity: 'high',
                              confirmLabel: 'Suspend',
                              onConfirm: () => suspendMutation.mutateAsync(u.id),
                            })}
                            className="btn-secondary"
                            style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem', color: 'var(--color-danger-hover)' }}
                          >
                            Suspend
                          </button>
                        ) : (
                          <button
                            onClick={() => confirm({
                              title: `Lift the suspension on @${u.username}?`,
                              description: 'They regain full access to Meetifyy immediately.',
                              severity: 'moderate',
                              confirmLabel: 'Unsuspend',
                              onConfirm: () => unsuspendMutation.mutateAsync(u.id),
                            })}
                            className="btn-secondary"
                            style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem', color: 'var(--color-success)' }}
                          >
                            Unsuspend
                          </button>
                        )}

                        {u.collegeId && (
                          <button
                            onClick={() => confirm({
                              title: `Reset the college for @${u.username}?`,
                              description: 'Their current college is cleared and they are asked to pick one again.',
                              consequences: [
                                'They lose access to campus-only spaces until they re-select.',
                                'Verification tied to the old college does not carry over.',
                              ],
                              severity: 'high',
                              confirmLabel: 'Reset college',
                              onConfirm: () => resetCollegeMutation.mutateAsync(u.id),
                            })}
                            className="btn-secondary"
                            style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                          >
                            Reset College
                          </button>
                        )}

                        {u.accountStatus === 'BANNED' ? (
                          <button
                            onClick={() => confirm({
                              title: `Restore @${u.username}?`,
                              description: 'The account is reinstated and becomes usable again.',
                              severity: 'moderate',
                              confirmLabel: 'Restore',
                              onConfirm: () => restoreMutation.mutateAsync(u.id),
                            })}
                            className="btn-secondary"
                            style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                          >
                            Restore
                          </button>
                        ) : (
                          <button
                            onClick={() => confirm({
                              title: `Delete @${u.username}?`,
                              description: 'This removes the account from Meetifyy.',
                              consequences: [
                                'Their posts, messages and community memberships go with it.',
                                'This cannot be undone from the admin portal.',
                              ],
                              severity: 'critical',
                              confirmLabel: 'Delete user',
                              onConfirm: () => deleteMutation.mutateAsync(u.id),
                            })}
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

        <Pagination
          page={page}
          totalPages={data?.meta?.totalPages}
          total={data?.meta?.total}
          onChange={setPage}
          label="users"
          busy={isLoading}
        />
      </div>
    </div>
  );
};
