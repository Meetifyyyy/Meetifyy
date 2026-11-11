import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../api/apiClient';
import { Search, X, Users, UserCheck, Shield, AlertCircle, RefreshCw, Eye, Trash2, Mail, ShieldAlert } from '../components/icons';
import { useDebounced } from '../hooks/useDebounced';
import { Pagination } from '../components/Pagination';
import { useConfirm } from '../components/ConfirmProvider';
import UserAvatar from '../components/UserAvatar';
import { formatDate } from './legal/legalFormat';
import { Dropdown } from '../components/Dropdown';
import { LoadingState } from '../components/LoadingState';
import './users.css';


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
  const styles: Record<string, { label: string; color: string }> = {
    VERIFIED: { label: 'Verified', color: 'var(--color-success)' },
    PENDING: { label: 'Pending review', color: 'var(--color-warning)' },
    REJECTED: { label: 'Rejected', color: 'var(--color-danger)' },
    RESUBMISSION_REQUIRED: { label: 'Resubmission needed', color: 'var(--color-warning)' },
  };
  const shown = styles[status ?? ''] ?? {
    label: 'Unverified',
    color: 'var(--color-text-light)',
  };

  return (
    <span className="user-verification" style={{ color: shown.color }}>
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
  <div className="user-detail-row">
    <div className="user-detail-row-label">{label}</div>
    <div style={{ minWidth: 0, color: 'var(--color-text-main)', overflowWrap: 'anywhere' }}>{children}</div>
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
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const surfaces = [document.documentElement, document.body, document.querySelector<HTMLElement>('.admin-content-surface')].filter((node): node is HTMLElement => Boolean(node));
    const overflow = surfaces.map((node) => node.style.overflow);
    surfaces.forEach((node) => { node.style.overflow = 'hidden'; });
    dialog?.querySelector<HTMLElement>('.dialog-close')?.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (document.querySelector('[role="alertdialog"]')) return;
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
      if (event.key !== 'Tab' || !dialog) return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]'));
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      surfaces.forEach((node, index) => { node.style.overflow = overflow[index]; });
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  const { data: user, isLoading, error, refetch } = useQuery({
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

  const restoreMutation = useMutation({
    mutationFn: () => apiRequest(`/admin/users/${userId}/restore`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminUser', userId] });
      queryClient.invalidateQueries({ queryKey: ['adminUsers'] });
      queryClient.invalidateQueries({ queryKey: ['adminAccountDeletion'] });
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
      <div ref={dialogRef} className="modal-content dialog-form admin-dialog-layout user-details-modal" role="dialog" aria-modal="true" aria-labelledby="user-details-title" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h3 id="user-details-title">User details</h3>
          <button onClick={onClose} aria-label="Close" className="dialog-close">
            <X size={18} />
          </button>
        </div>

        <div className="admin-dialog-body">
          {isLoading ? (
            <LoadingState label="Loading user details…" compact />
          ) : error || !user ? (
            <div style={{ background: 'var(--color-danger-tint)', color: 'var(--color-danger-hover)', padding: '0.6rem 0.75rem', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem' }}>
              {(error as Error | null)?.message || 'Could not load this user.'}
              <button className="btn-secondary" onClick={() => refetch()}>Try again</button>
            </div>
          ) : (
            <>
              <div className="user-profile-heading">
                <UserAvatar user={user} size={52} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: 'var(--color-text-main)' }}>{user.displayName || user.username}</div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--color-text-light)' }}>@{user.username}</div>
                </div>
              </div>
              <div className="user-details-layout">
              <section className="user-account-section" aria-labelledby="user-account-title">
                <h4 id="user-account-title">Account overview</h4>
              <div className="user-profile-facts">
                <DetailRow label="Login email">{user.email}</DetailRow>
                <DetailRow label="Account">{accountStatusLabel(user.accountStatus)}</DetailRow>
                <DetailRow label="Selfie ID"><VerificationLabel status={user.verificationStatus} /></DetailRow>
                <DetailRow label="Joined">{fmtDate(user.createdAt)}</DetailRow>
              </div>
              {['DELETED', 'PENDING_DELETION'].includes(user.accountStatus) && !user.purgeCompletedAt && (
                <div className="user-recovery-actions">
                  <button className="btn-secondary" onClick={() => confirm({
                    title: `Restore @${user.username}?`,
                    description: 'The account becomes active again and any scheduled deletion is cancelled.',
                    consequences: ['Restore only at the account owner’s request.'],
                    severity: 'moderate',
                    confirmLabel: 'Restore account',
                    onConfirm: () => restoreMutation.mutateAsync(),
                  })}>Restore account</button>
                </div>
              )}
              {user.purgeCompletedAt && <p className="user-permanent-note">Permanently deleted. This account cannot be restored.</p>}

              </section>
              <section className="user-affiliation-section" aria-labelledby="user-affiliation-title">
              <div className="user-affiliation-heading">
                <h4 id="user-affiliation-title">College affiliation</h4>
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
                  <DetailRow label="College email">{aff.email}</DetailRow>
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
              </section>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};

const USER_FILTERS = [
  { id: '', label: 'All accounts' },
  { id: 'ACTIVE', label: 'Active' },
  { id: 'SUSPENDED', label: 'Suspended' },
  { id: 'BANNED', label: 'Banned' },
  { id: 'PENDING_DELETION', label: 'Deletion requested' },
  { id: 'DELETED', label: 'Deleted' },
];

export const UsersPage: React.FC = () => {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  // The query is keyed on this, so debouncing is what stops one request per
  // keystroke from being sent to the users endpoint.
  const debouncedSearch = useDebounced(search.trim(), 300);
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [detailUserId, setDetailUserId] = useState<string | null>(null);

  // Any change to what is being filtered invalidates the current page number.
  useEffect(() => { setPage(1); }, [debouncedSearch, statusFilter]);

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['adminUsers', debouncedSearch, statusFilter, page],
    queryFn: () =>
      apiRequest(
        `/admin/users?search=${encodeURIComponent(debouncedSearch)}&accountStatus=${statusFilter}&page=${page}`,
      ),
  });

  useEffect(() => {
    const lastPage = data?.meta?.totalPages;
    if (lastPage !== undefined && page > Math.max(1, lastPage)) setPage(Math.max(1, lastPage));
  }, [data?.meta?.totalPages, page]);

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminUsers'] });
      queryClient.invalidateQueries({ queryKey: ['adminUser'] });
    },
  });

  const unsuspendMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/admin/users/${id}/unsuspend`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminUsers'] });
      queryClient.invalidateQueries({ queryKey: ['adminUser'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/admin/users/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminUsers'] });
      queryClient.invalidateQueries({ queryKey: ['adminUser'] });
    },
  });

  const resetCollegeMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/admin/users/${id}/reset-college`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminUsers'] });
      queryClient.invalidateQueries({ queryKey: ['adminUser'] });
    },
  });

  return (
    <div className="admin-page users-page">
      <div className="page-header">
        <div>
          <h2 className="page-title">Users & Accounts</h2>
          <p className="page-subtitle">User profiles, identity verification, and account statuses.</p>
        </div>
      </div>

      <div className="users-summary" aria-label="User totals for the current filters">
        {[
          { label: 'Total users', value: metrics.total, tone: 'blue', icon: Users },
          { label: 'Active accounts', value: metrics.active, tone: 'green', icon: UserCheck },
          { label: 'Selfie-verified', value: metrics.verified, tone: 'violet', icon: Shield },
          { label: 'Suspended / banned', value: metrics.suspendedBanned, tone: 'peach', icon: AlertCircle },
        ].map(({ label, value, tone, icon: Icon }) => (
          <dl key={label} className={`users-summary-card tone-${tone}`}>
            <dt><span>{label}</span><Icon size={20} aria-hidden="true" /></dt>
            <dd>{isLoading ? '…' : error && !data ? '—' : value.toLocaleString()}</dd>
          </dl>
        ))}
      </div>

      <section className="users-directory" aria-labelledby="user-directory-title">
      <div className="users-section-heading">
        <h3 id="user-directory-title">User directory</h3>
        <span role="status">{isFetching ? 'Updating…' : 'Totals reflect current filters'}</span>
      </div>
      <div className="users-toolbar">
        <div className="users-search">
          <Search size={18} aria-hidden="true" />
          <input ref={searchInputRef} type="search" autoCapitalize="none" spellCheck={false} aria-label="Search users by name, username, or email"
            placeholder="Search users…" value={search} onChange={(event) => setSearch(event.target.value)}
            className="input-control" />
          {search && <button onClick={() => { setSearch(''); searchInputRef.current?.focus({ preventScroll: true }); }} aria-label="Clear user search"><X size={17} /></button>}
        </div>
        <div className="users-status-options" aria-label="Filter by account status">
          {USER_FILTERS.map((item) => (
            <button key={item.id} onClick={() => { setStatusFilter(item.id); setPage(1); }}
              className={statusFilter === item.id ? 'is-active' : ''} aria-pressed={statusFilter === item.id}>
              {item.id ? item.label : 'All'}
            </button>
          ))}
        </div>
        <div className="users-status-dropdown">
          <Dropdown aria-label="Account status" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }}>
            {USER_FILTERS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </Dropdown>
        </div>
      </div>
      {error && <div className="users-error" role="alert">
        <AlertCircle size={18} aria-hidden="true" /><span>{(error as Error).message || 'Could not load users.'}</span>
        <button className="btn-secondary" onClick={() => refetch()}><RefreshCw size={16} />Try again</button>
      </div>}

      {/* TABLE */}
      <div className="users-directory-panel" aria-busy={isFetching}>
        {isLoading ? (
          <LoadingState label="Loading users…" />
        ) : (
          <div className="table-responsive">
            <table className="admin-table users-table" role="table" aria-label="User directory">
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
                    <td className="user-cell-identity">
                      <div className="user-row-identity">
                        <UserAvatar user={u} size={38} />
                        <div>
                          <div className="user-row-name">{u.displayName || u.username}</div>
                          <div className="user-row-handle">@{u.username}</div>
                        </div>
                      </div>
                    </td>

                    <td className="user-cell-email">
                      <div className="user-row-email"><Mail size={15} aria-hidden="true" /><span>{u.email}</span></div>
                      <div className="user-email-verification"><VerificationLabel status={u.verificationStatus} /></div>
                    </td>

                    <td className="user-cell-college">
                      {u.college?.name || '—'}
                    </td>

                    <td className="user-cell-status">
                      {u.accountStatus === 'ACTIVE' ? (
                        <span className="badge badge-success">Active</span>
                      ) : u.accountStatus === 'SUSPENDED' ? (
                        <span className="badge badge-warning">Suspended</span>
                      ) : u.accountStatus === 'BANNED' ? (
                        <span className="badge badge-danger">Banned</span>
                      ) : (
                        <span className="badge badge-neutral">{accountStatusLabel(u.accountStatus)}</span>
                      )}
                      <div className="user-header-verification"><VerificationLabel status={u.verificationStatus} /></div>
                    </td>

                    <td className="user-cell-joined">
                      {fmtDate(u.createdAt)}
                    </td>

                    <td className="user-cell-actions">
                      <div className="user-row-actions">
                        <button
                          onClick={() => setDetailUserId(u.id)}
                          className="btn-secondary user-action-details"
                          aria-label={`View details for @${u.username}`} title="User details"
                        >
                          <Eye size={16} aria-hidden="true" /><span className="user-action-label">Details</span>
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
                            data-tone="warning"
                            aria-label={`Suspend @${u.username}`} title="Suspend account"
                          >
                            <ShieldAlert className="user-action-state-icon" size={16} aria-hidden="true" /><span className="user-action-label">Suspend</span>
                          </button>
                        ) : u.accountStatus === 'SUSPENDED' ? (
                          <button
                            onClick={() => confirm({
                              title: `Lift the suspension on @${u.username}?`,
                              description: 'They regain full access to Meetifyy immediately.',
                              severity: 'moderate',
                              confirmLabel: 'Unsuspend',
                              onConfirm: () => unsuspendMutation.mutateAsync(u.id),
                            })}
                            className="btn-secondary"
                            data-tone="success"
                            aria-label={`Unsuspend @${u.username}`} title="Unsuspend account"
                          >
                            <UserCheck className="user-action-state-icon" size={16} aria-hidden="true" /><span className="user-action-label">Unsuspend</span>
                          </button>
                        ) : null}

                        {u.college?.id && (
                          <button
                            onClick={() => confirm({
                              title: `Reset the college for @${u.username}?`,
                              description: 'Their verified college affiliation is cleared. They must verify a college email again to regain campus access.',
                              consequences: [
                                'They lose access to campus-only spaces until they verify again.',
                                'Verification tied to the old college does not carry over.',
                              ],
                              severity: 'high',
                              confirmLabel: 'Reset college',
                              onConfirm: () => resetCollegeMutation.mutateAsync(u.id),
                            })}
                            className="btn-secondary user-action-icon"
                            aria-label={`Reset college for @${u.username}`}
                            title="Reset college"
                          >
                            <RefreshCw size={16} aria-hidden="true" /><span className="user-action-label">Reset College</span>
                          </button>
                        )}

                        {['ACTIVE', 'SUSPENDED', 'BANNED'].includes(u.accountStatus) && (
                          <button
                            onClick={() => confirm({
                              title: `Delete @${u.username}?`,
                              description: 'This marks the account as deleted and signs the user out.',
                              consequences: [
                                'Their active sessions are revoked immediately.',
                                'The account stays inaccessible unless an administrator restores it.',
                              ],
                              severity: 'critical',
                              confirmLabel: 'Delete user',
                              onConfirm: () => deleteMutation.mutateAsync(u.id),
                            })}
                            className="btn-danger user-action-icon"
                            aria-label={`Delete @${u.username}`}
                            title="Delete user"
                          >
                            <Trash2 size={16} aria-hidden="true" /><span className="user-action-label">Delete</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}

                {usersList.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', color: 'var(--color-text-dim)', padding: '2.5rem 1rem' }}>
                      {error ? 'Users are unavailable. Try again above.' : 'No users match your filters.'}
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
          busy={isFetching}
        />
      </div>

      </section>

      {detailUserId && <UserDetailModal userId={detailUserId} onClose={() => setDetailUserId(null)} />}
    </div>
  );
};
