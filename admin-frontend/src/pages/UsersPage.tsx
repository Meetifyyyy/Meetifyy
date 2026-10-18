import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../api/apiClient';
import { Search, X } from '../components/icons';
import { useDebounced } from '../hooks/useDebounced';
import { Pagination } from '../components/Pagination';
import { useConfirm } from '../components/ConfirmProvider';
import UserAvatar from '../components/UserAvatar';
import { formatDate } from './legal/legalFormat';


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

const AFFILIATION_METHODS: Record<string, string> = {
  CAMPUS_OTP: 'College email code (Campus page)',
  LEGACY_PRIMARY_EMAIL: 'Legacy: signed up with this college email',
};

const REASON_MAX = 300;

/** Dates the way the Legal pages show them: "Sep 10, 2026". */
const fmtDate = (iso?: string | null) => formatDate(iso);

/** Account states in words, not enum names. */
const ACCOUNT_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  BANNED: 'Banned',
  PENDING_DELETION: 'Deletion requested',
  DELETED: 'Deleted',
};

const accountStatusLabel = (status?: string | null): string =>
  (status && ACCOUNT_STATUS_LABELS[status]) ||
  (status ? status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, ' ') : '—');

const DetailRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ display: 'flex', gap: '0.75rem', padding: '0.3rem 0', fontSize: '0.78rem', alignItems: 'baseline' }}>
    <div style={{ width: 110, flexShrink: 0, color: 'var(--color-text-light)', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</div>
    <div style={{ minWidth: 0, color: 'var(--color-text-main)', wordBreak: 'break-word' }}>{children}</div>
  </div>
);

/**
 * One user's profile and college affiliation, with the revoke action.
 *
 * Revoking asks for a reason first (kept on the affiliation as audit trail),
 * then goes through the portal's shared confirmation dialog, which sits above
 * this modal.
 */
const UserDetailModal: React.FC<{ userId: string; onClose: () => void }> = ({ userId, onClose }) => {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');

  const { data: user, isLoading, error } = useQuery({
    queryKey: ['adminUser', userId],
    queryFn: () => apiRequest(`/admin/users/${userId}`),
  });

  const revokeMutation = useMutation({
    mutationFn: (body: { reason: string }) =>
      apiRequest(`/admin/users/${userId}/college-affiliation/revoke`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminUser', userId] });
      queryClient.invalidateQueries({ queryKey: ['adminUsers'] });
      setAsking(false);
      setReason('');
    },
  });

  const aff = user?.collegeAffiliation ?? null;
  const trimmed = reason.trim();

  const askToConfirm = () => {
    if (!trimmed) return;
    confirm({
      title: `Revoke college affiliation for @${user.username}?`,
      description: `They lose Campus access for ${aff.collegeName}. Reason: "${trimmed}"`,
      consequences: [
        'Campus pages and campus-only spaces close to them immediately.',
        'The college email stays reserved so nobody else can claim it.',
        'They can verify a college email again only after an admin clears it.',
      ],
      severity: 'high',
      confirmLabel: 'Revoke affiliation',
      onConfirm: () => revokeMutation.mutateAsync({ reason: trimmed }),
    });
  };

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ padding: '1.25rem 1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.9rem' }}>
          <h3 style={{ fontSize: '1.05rem', fontWeight: 700 }}>User details</h3>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-dim)' }}>
            <X size={18} />
          </button>
        </div>

        {isLoading ? (
          <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--color-text-dim)', fontSize: '0.8rem' }}>Loading...</div>
        ) : error || !user ? (
          <div style={{ background: 'var(--color-danger-tint)', color: 'var(--color-danger-hover)', padding: '0.6rem 0.75rem', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem' }}>
            {(error as Error | null)?.message || 'Could not load this user.'}
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginBottom: '0.6rem' }}>
              <UserAvatar user={user} size={40} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: 'var(--color-text-main)' }}>{user.displayName || user.username}</div>
                <div style={{ fontSize: '0.74rem', color: 'var(--color-text-light)' }}>@{user.username}</div>
              </div>
            </div>
            <DetailRow label="Login email">{user.email}</DetailRow>
            <DetailRow label="Account">{accountStatusLabel(user.accountStatus)}</DetailRow>
            <DetailRow label="Selfie ID"><VerificationLabel status={user.verificationStatus} /></DetailRow>
            <DetailRow label="Joined">{fmtDate(user.createdAt)}</DetailRow>

            <div style={{ borderTop: '1px solid var(--color-border)', margin: '0.75rem 0 0.6rem' }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 700 }}>College affiliation</div>
              {aff && (aff.revokedAt
                ? <span className="badge badge-danger">Revoked</span>
                : <span className="badge badge-success">Active</span>)}
            </div>

            {!aff ? (
              <div style={{ fontSize: '0.78rem', color: 'var(--color-text-dim)', padding: '0.3rem 0' }}>
                No verified college email.
              </div>
            ) : (
              <>
                <DetailRow label="College">{aff.collegeName}</DetailRow>
                <DetailRow label="College email"><span style={{ fontFamily: 'monospace' }}>{aff.email}</span></DetailRow>
                <DetailRow label="Method">{AFFILIATION_METHODS[aff.method] ?? aff.method}</DetailRow>
                <DetailRow label="Verified">{fmtDate(aff.verifiedAt)}</DetailRow>
                {aff.revokedAt && <DetailRow label="Revoked">{fmtDate(aff.revokedAt)}</DetailRow>}
                {aff.revokedAt && aff.revokedReason && <DetailRow label="Reason">{aff.revokedReason}</DetailRow>}

                {!aff.revokedAt && !asking && (
                  <div style={{ marginTop: '0.75rem' }}>
                    <button className="btn-danger" style={{ fontSize: '0.75rem', padding: '0.3rem 0.7rem' }} onClick={() => setAsking(true)}>
                      Revoke affiliation
                    </button>
                  </div>
                )}

                {!aff.revokedAt && asking && (
                  <div style={{ marginTop: '0.75rem' }}>
                    <label htmlFor="revoke-reason" style={{ display: 'block', fontSize: '0.76rem', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '0.3rem' }}>
                      Reason (required, kept for the audit trail)
                    </label>
                    <textarea
                      id="revoke-reason"
                      className="input-control"
                      rows={3}
                      maxLength={REASON_MAX}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="e.g. College email belongs to someone else"
                      style={{ resize: 'vertical' }}
                    />
                    <div style={{ fontSize: '0.66rem', color: 'var(--color-text-dim)', textAlign: 'right' }}>{reason.length}/{REASON_MAX}</div>
                    <div className="modal-actions" style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.4rem' }}>
                      <button className="btn-secondary" onClick={() => { setAsking(false); setReason(''); }}>Cancel</button>
                      <button className="btn-danger" disabled={!trimmed} onClick={askToConfirm}>Continue</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
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
  const [detailUserId, setDetailUserId] = useState<string | null>(null);

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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 140px), 1fr))', gap: '0.85rem', marginBottom: '1.25rem' }}>
        <div className="glass-panel" style={{ padding: '0.85rem 1rem' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-light)', textTransform: 'uppercase' }}>Total Users</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--color-text-main)', marginTop: '0.15rem' }}>{metrics.total}</div>
        </div>

        <div className="glass-panel" style={{ padding: '0.85rem 1rem' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-light)', textTransform: 'uppercase' }}>Active</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--color-text-main)', marginTop: '0.15rem' }}>{metrics.active}</div>
        </div>

        <div className="glass-panel" style={{ padding: '0.85rem 1rem' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-light)', textTransform: 'uppercase' }}>Selfie-verified</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--color-text-main)', marginTop: '0.15rem' }}>{metrics.verified}</div>
        </div>

        <div className="glass-panel" style={{ padding: '0.85rem 1rem' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-light)', textTransform: 'uppercase' }}>Suspended / Banned</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--color-text-main)', marginTop: '0.15rem' }}>{metrics.suspendedBanned}</div>
        </div>
      </div>

      {/* SEARCH AND FILTERS */}
      <div className="glass-panel admin-filter-bar" style={{ padding: '0.55rem 0.75rem', marginBottom: '0.85rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: '200px' }}>
          <Search size={14} color="var(--color-text-dim)" style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)' }} />
          <input
            type="text"
            placeholder="Search name, @username, or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-control"
            style={{ paddingLeft: '2rem', fontSize: '0.78rem' }}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              style={{ position: 'absolute', right: '0.6rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--color-text-dim)', cursor: 'pointer' }}
            >
              <X size={13} />
            </button>
          )}
        </div>

        <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
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
                style={{ padding: '0.25rem 0.55rem', fontSize: '0.72rem' }}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* TABLE */}
      <div className="glass-panel" style={{ overflow: 'hidden', padding: 0 }}>
        {isLoading ? (
          <div style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--color-text-dim)', fontSize: '0.8rem' }}>
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
                  <th className="col-actions" style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {usersList.map((u: any) => (
                  <tr key={u.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <UserAvatar user={u} size={26} />
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--color-text-main)', fontSize: '0.76rem', lineHeight: 1.25 }}>{u.displayName || u.username}</div>
                          <div style={{ fontSize: '0.66rem', color: 'var(--color-text-light)' }}>@{u.username}</div>
                        </div>
                      </div>
                    </td>

                    <td>
                      <div style={{ fontSize: '0.74rem', color: 'var(--color-text-main)', fontWeight: 500, lineHeight: 1.25 }}>{u.email}</div>
                      <VerificationLabel status={u.verificationStatus} />
                    </td>

                    <td style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                      {u.college?.name || '—'}
                    </td>

                    <td style={{ textAlign: 'center' }}>
                      {u.accountStatus === 'ACTIVE' ? (
                        <span className="badge badge-success">Active</span>
                      ) : u.accountStatus === 'SUSPENDED' ? (
                        <span className="badge badge-warning">Suspended</span>
                      ) : u.accountStatus === 'BANNED' ? (
                        <span className="badge badge-danger">Banned</span>
                      ) : (
                        <span className="badge badge-neutral">{accountStatusLabel(u.accountStatus)}</span>
                      )}
                    </td>

                    <td style={{ fontSize: '0.7rem', color: 'var(--color-text-light)' }}>
                      {fmtDate(u.createdAt)}
                    </td>

                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        <button
                          onClick={() => setDetailUserId(u.id)}
                          className="btn-secondary"
                          style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                        >
                          Details
                        </button>
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

      {detailUserId && <UserDetailModal userId={detailUserId} onClose={() => setDetailUserId(null)} />}
    </div>
  );
};
