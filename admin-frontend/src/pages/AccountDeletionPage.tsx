import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../api/apiClient';
import { Pagination } from '../components/Pagination';
import { pushToast } from '../components/Toaster';
import { useDebounced } from '../hooks/useDebounced';
import {
  Trash2,
  Clock,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  UserCheck,
  Search,
} from '../components/icons';
import { useConfirm } from '../components/ConfirmProvider';

type Filter = 'pending' | 'failed' | 'completed' | 'all';

interface DeletionRequest {
  userId: string;
  username: string;
  email: string;
  college: string | null;
  accountStatus: string;
  deletionRequestedAt: string | null;
  scheduledPurgeAt: string | null;
  purgeCompletedAt: string | null;
  purgeAttempts: number;
  purgeLastError: string | null;
  daysRemaining: number | null;
  dueNow: boolean;
  purgeInProgress: boolean;
  status: 'pending' | 'due' | 'failed' | 'completed';
  /**
   * Whether the corresponding action can actually succeed right now. Rendering
   * is keyed off these rather than off the status string, so this page never
   * shows a control that the backend would refuse — a restore is impossible
   * once the purge worker has claimed the row or the window has closed, and a
   * purge is refused while the account is still inside that window, because the
   * 30 days are a promise to its owner rather than a scheduling detail.
   */
  canRestore: boolean;
  canPurgeNow: boolean;
}

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'failed', label: 'Needs attention' },
  { key: 'completed', label: 'Completed' },
  { key: 'all', label: 'All' },
];

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  pending: { bg: 'rgba(234, 179, 8, 0.18)', fg: '#eab308', label: 'In recovery window' },
  due: { bg: 'rgba(249, 115, 22, 0.18)', fg: '#f97316', label: 'Due for deletion' },
  failed: { bg: 'rgba(239, 68, 68, 0.18)', fg: '#ef4444', label: 'Purge failed' },
  completed: { bg: 'rgba(148, 163, 184, 0.18)', fg: '#94a3b8', label: 'Deleted' },
};

/**
 * Account Deletion — the 30-day retention queue.
 *
 * Its own section rather than a tab under Users, because the job is different:
 * these rows carry a deadline the platform has committed to, and the queue is
 * ordered by it. Every column here is lifecycle metadata; the page deliberately
 * shows no bio, avatar or profile content for someone who asked to be forgotten.
 */
export const AccountDeletionPage: React.FC = () => {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>('pending');
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounced(searchInput, 300);
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['adminAccountDeletion', filter, page, search],
    queryFn: () => {
      const params = new URLSearchParams({ filter, page: String(page) });
      if (search) params.set('search', search);
      return apiRequest(`/admin/account-deletion?${params.toString()}`);
    },
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['adminAccountDeletion'] });

  const restore = useMutation({
    mutationFn: (userId: string) =>
      apiRequest(`/admin/account-deletion/${userId}/restore`, { method: 'POST' }),
    onSuccess: () => {
      pushToast('Account restored', 'success');
      invalidate();
    },
    // The backend's message is shown verbatim — it is the one that knows
    // whether the window closed or the worker got there first.
    onError: (err: any) =>
      pushToast(err?.message || 'Could not restore this account'),
  });

  const purgeNow = useMutation({
    mutationFn: (userId: string) =>
      apiRequest(`/admin/account-deletion/${userId}/purge`, { method: 'POST' }),
    onSuccess: () => {
      pushToast('Permanent deletion completed', 'success');
      invalidate();
    },
    onError: (err: any) =>
      pushToast(err?.message || 'Could not complete permanent deletion'),
  });

  const runSweep = useMutation({
    mutationFn: () =>
      apiRequest('/admin/account-deletion/run-sweep', { method: 'POST' }),
    onSuccess: (res: any) => {
      pushToast(
        `Sweep finished — ${res?.purged ?? 0} deleted, ${res?.failed ?? 0} failed`,
        'success',
      );
      invalidate();
    },
    onError: (err: any) => pushToast(err?.message || 'Sweep failed'),
  });

  const requests: DeletionRequest[] = data?.requests || [];
  const counts = data?.counts;
  const busy = restore.isPending || purgeNow.isPending;

  return (
    <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto', color: 'var(--color-text-main)' }}>
      <header style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 600, color: 'var(--color-text-white)', marginBottom: '0.25rem' }}>
            Account Deletion
          </h1>
          <p style={{ color: 'var(--color-text-light)', fontSize: '0.9rem' }}>
            Deletion requests and the {data?.recoveryWindowDays ?? 30}-day recovery window.
            Accounts are permanently deleted automatically once the window closes.
          </p>
        </div>
        <button
          onClick={() => confirm({
            title: 'Run the purge sweep now?',
            description: 'Every account whose 30-day recovery window has closed is permanently deleted immediately, rather than on the next scheduled run.',
            consequences: [
              'This affects all due accounts at once, not one person.',
              'Posts, activities and uploaded media are removed and cannot be recovered.',
            ],
            severity: 'critical',
            confirmLabel: 'Run sweep',
            onConfirm: () => runSweep.mutateAsync(),
          })}
          disabled={runSweep.isPending}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
            padding: '0.55rem 1rem', borderRadius: '8px',
            border: '1px solid var(--color-border)',
            background: 'var(--color-bg-panel)',
            color: 'var(--color-text-white)',
            fontSize: '0.875rem',
            cursor: runSweep.isPending ? 'not-allowed' : 'pointer',
            opacity: runSweep.isPending ? 0.6 : 1,
          }}
          title="Runs the scheduled purge sweep immediately instead of waiting for the next one"
        >
          <RefreshCw size={16} />
          {runSweep.isPending ? 'Running sweep…' : 'Run purge sweep now'}
        </button>
      </header>

      {counts && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
          <StatTile icon={<Clock size={16} />} label="In recovery window" value={counts.pending} />
          <StatTile icon={<Trash2 size={16} />} label="Due for deletion" value={counts.dueNow} tone="#f97316" />
          <StatTile icon={<AlertTriangle size={16} />} label="Needs attention" value={counts.failed} tone="#ef4444" />
          <StatTile icon={<CheckCircle size={16} />} label="Deleted" value={counts.completed} tone="#94a3b8" />
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => { setFilter(f.key); setPage(1); }}
              style={{
                padding: '0.5rem 1rem', borderRadius: '6px', border: '1px solid',
                borderColor: filter === f.key ? 'var(--color-brand)' : 'var(--color-border)',
                background: filter === f.key ? 'var(--color-brand-alpha)' : 'var(--color-bg-panel)',
                color: filter === f.key ? 'var(--color-brand)' : 'var(--color-text-light)',
                fontSize: '0.875rem', cursor: 'pointer',
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: '320px' }}>
          <Search size={15} style={{ position: 'absolute', left: '0.7rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-light)' }} />
          <input
            value={searchInput}
            onChange={(e) => { setSearchInput(e.target.value); setPage(1); }}
            placeholder="Search username, email or user ID"
            style={{
              width: '100%', padding: '0.55rem 0.75rem 0.55rem 2.1rem',
              borderRadius: '8px', border: '1px solid var(--color-border)',
              background: 'var(--color-bg-panel)', color: 'var(--color-text-white)',
              fontSize: '0.875rem', boxSizing: 'border-box',
            }}
          />
        </div>
      </div>

      {isLoading ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-text-light)' }}>Loading requests…</div>
      ) : requests.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', background: 'var(--color-bg-panel)', borderRadius: '12px', border: '1px solid var(--color-border)' }}>
          <CheckCircle size={48} style={{ color: 'var(--color-success)', margin: '0 auto 1rem', opacity: 0.5 }} />
          <h3 style={{ fontSize: '1.1rem', color: 'var(--color-text-white)', marginBottom: '0.5rem' }}>Nothing here</h3>
          <p style={{ color: 'var(--color-text-light)', fontSize: '0.9rem' }}>
            No account-deletion requests match this filter.
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '0.75rem', opacity: isFetching ? 0.7 : 1 }}>
          {requests.map((req) => (
            <RequestRow
              key={req.userId}
              request={req}
              busy={busy}
              onRestore={() => confirm({
                title: 'Restore this account?',
                description: `This cancels the pending deletion for @${req.username} and makes the account active and visible again.`,
                consequences: ['Do this only at the account owner\u2019s request.'],
                severity: 'moderate',
                confirmLabel: 'Restore account',
                onConfirm: () => restore.mutateAsync(req.userId),
              })}
              onPurge={() => confirm({
                title: 'Delete this account permanently?',
                description: `The 30-day recovery window for @${req.username} has already closed, so this runs the permanent deletion now instead of waiting for the next scheduled sweep.`,
                consequences: [
                  'Their posts, activities and uploaded media are removed and cannot be recovered.',
                  'Their messages stay in other people\u2019s conversations, shown as a deleted account.',
                ],
                severity: 'critical',
                confirmLabel: 'Delete permanently',
                onConfirm: () => purgeNow.mutateAsync(req.userId),
              })}
            />
          ))}
        </div>
      )}

      <Pagination
        page={page}
        totalPages={data?.pagination?.totalPages}
        total={data?.pagination?.total}
        onChange={setPage}
        label="requests"
        busy={isFetching}
      />

    </div>
  );
};

const StatTile: React.FC<{ icon: React.ReactNode; label: string; value: number; tone?: string }> = ({
  icon, label, value, tone,
}) => (
  <div style={{ background: 'var(--color-bg-panel)', border: '1px solid var(--color-border)', borderRadius: '10px', padding: '0.9rem 1rem' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: tone || 'var(--color-text-light)', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
      {icon}
      <span>{label}</span>
    </div>
    <div style={{ marginTop: '0.35rem', fontSize: '1.5rem', fontWeight: 700, color: 'var(--color-text-white)' }}>
      {value}
    </div>
  </div>
);

const RequestRow: React.FC<{
  request: DeletionRequest;
  busy: boolean;
  onRestore: () => void;
  onPurge: () => void;
}> = ({ request, busy, onRestore, onPurge }) => {
  const style = STATUS_STYLE[request.status] ?? STATUS_STYLE.pending;

  return (
    <div style={{
      background: 'var(--color-bg-panel)', border: '1px solid var(--color-border)',
      borderRadius: '12px', padding: '1.1rem 1.25rem',
      display: 'flex', gap: '1rem', justifyContent: 'space-between',
      alignItems: 'flex-start', flexWrap: 'wrap',
    }}>
      <div style={{ minWidth: 0, flex: '1 1 340px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-white)' }}>
            @{request.username}
          </span>
          <span style={{ padding: '0.2rem 0.6rem', borderRadius: '9999px', fontSize: '0.72rem', fontWeight: 600, background: style.bg, color: style.fg }}>
            {style.label}
          </span>
          {request.purgeInProgress && (
            <span style={{ fontSize: '0.72rem', color: 'var(--color-text-light)' }}>
              purge in progress
            </span>
          )}
        </div>

        <div style={{ marginTop: '0.4rem', fontSize: '0.82rem', color: 'var(--color-text-light)', display: 'grid', gap: '0.15rem' }}>
          <span style={{ wordBreak: 'break-all' }}>{request.email}</span>
          {request.college && <span>{request.college}</span>}
          <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.74rem', opacity: 0.75 }}>
            {request.userId}
          </span>
        </div>

        <div style={{ marginTop: '0.6rem', display: 'flex', gap: '1.5rem', flexWrap: 'wrap', fontSize: '0.8rem', color: 'var(--color-text-light)' }}>
          <Field label="Requested" value={formatDate(request.deletionRequestedAt)} />
          {request.status === 'completed' ? (
            <Field label="Deleted" value={formatDate(request.purgeCompletedAt)} />
          ) : (
            <>
              <Field label="Scheduled deletion" value={formatDate(request.scheduledPurgeAt)} />
              <Field
                label="Remaining"
                value={
                  request.dueNow
                    ? 'Due now'
                    : request.daysRemaining === null
                      ? '—'
                      : `${request.daysRemaining} day${request.daysRemaining === 1 ? '' : 's'}`
                }
              />
            </>
          )}
        </div>

        {request.purgeLastError && (
          <div style={{
            marginTop: '0.7rem', padding: '0.55rem 0.7rem', borderRadius: '8px',
            background: 'rgba(239, 68, 68, 0.12)', color: '#fca5a5',
            fontSize: '0.78rem', wordBreak: 'break-word',
          }}>
            Last failure ({request.purgeAttempts} attempt{request.purgeAttempts === 1 ? '' : 's'}): {request.purgeLastError}
          </div>
        )}
      </div>

      {/* Actions render only when the backend says they can succeed, so this
          panel never carries a control that does nothing when pressed. */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {request.canRestore && (
          <button onClick={onRestore} disabled={busy} style={actionStyle('#22c55e', busy)}>
            <UserCheck size={15} />
            Restore account
          </button>
        )}
        {request.canPurgeNow && (
          <button onClick={onPurge} disabled={busy} style={actionStyle('#ef4444', busy)}>
            <Trash2 size={15} />
            Delete permanently
          </button>
        )}
      </div>
    </div>
  );
};

const Field: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <span style={{ display: 'grid', gap: '0.1rem' }}>
    <span style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em', opacity: 0.7 }}>{label}</span>
    <span style={{ color: 'var(--color-text-white)' }}>{value}</span>
  </span>
);

const actionStyle = (color: string, busy: boolean): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.4rem',
  padding: '0.5rem 0.9rem',
  borderRadius: '8px',
  border: `1px solid ${color}55`,
  background: `${color}1a`,
  color,
  fontSize: '0.82rem',
  fontWeight: 600,
  cursor: busy ? 'not-allowed' : 'pointer',
  opacity: busy ? 0.6 : 1,
});

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export default AccountDeletionPage;
