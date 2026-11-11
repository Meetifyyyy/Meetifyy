import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../api/apiClient';
import { LoadingState } from '../components/LoadingState';
import './account-deletion.css';
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

const STATUS_LABELS = { pending: 'Recovery window', due: 'Due for deletion', failed: 'Purge failed', completed: 'Deleted' };
interface DeletionResponse {
  requests: DeletionRequest[];
  counts: { pending: number; dueNow: number; failed: number; completed: number };
  pagination: { page: number; totalPages: number; total: number };
  recoveryWindowDays: number;
}

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
  const { data, isLoading, isFetching, isError, error, refetch } = useQuery<DeletionResponse>({
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
      apiRequest(`/admin/account-deletion/${encodeURIComponent(userId)}/restore`, { method: 'POST' }),
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
      apiRequest(`/admin/account-deletion/${encodeURIComponent(userId)}/purge`, { method: 'POST' }),
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
  const busy = restore.isPending || purgeNow.isPending || runSweep.isPending;
  useEffect(() => { if (data && page > data.pagination.totalPages) setPage(Math.max(1, data.pagination.totalPages)); }, [data, page]);

  return (
    <div className="admin-page deletion-page">
      <div className="page-header">
        <div>
          <h2 className="page-title">Account Deletion</h2>
          <p className="page-subtitle">
            Accounts have a {data?.recoveryWindowDays ?? 30}-day recovery window before automatic permanent deletion.
          </p>
        </div>
        <button
          onClick={() => confirm({
            title: 'Run the purge sweep now?',
            description: `Every account whose ${data?.recoveryWindowDays ?? 30}-day recovery window has closed is permanently deleted immediately, rather than on the next scheduled run.`,
            consequences: [
              'This affects all due accounts at once, not one person.',
              'Posts, activities and uploaded media are removed and cannot be recovered.',
            ],
            severity: 'critical',
            confirmLabel: 'Run sweep',
            onConfirm: () => runSweep.mutateAsync(),
          })}
          disabled={busy || isFetching || !data || isError}
          className="btn-secondary deletion-sweep"
          title="Runs the scheduled purge sweep immediately instead of waiting for the next one"
        >
          <RefreshCw size={15} />
          <span>{runSweep.isPending ? 'Running sweep…' : 'Run purge sweep'}</span>
        </button>
      </div>

      <p className="deletion-summary-caption">Across all deletion requests</p>
      <dl className="deletion-summary" aria-label="Account deletion totals" aria-busy={isLoading}>
        <StatTile icon={<Clock size={17} />} label="Pending deletion" value={counts?.pending} tone="blue" />
        <StatTile icon={<Trash2 size={17} />} label="Due for deletion" value={counts?.dueNow} tone="peach" />
        <StatTile icon={<AlertTriangle size={17} />} label="Needs attention" value={counts?.failed} tone="violet" />
        <StatTile icon={<CheckCircle size={17} />} label="Deleted" value={counts?.completed} tone="green" />
      </dl>
      <div className="deletion-status-filters" role="group" aria-label="Deletion request status">
        {FILTERS.map((item) => <button type="button" key={item.key} aria-pressed={filter === item.key} onClick={() => { setFilter(item.key); setPage(1); }}>{item.label}</button>)}
      </div>
      <div className="deletion-toolbar">
        <div className="deletion-search"><Search size={18} /><input value={searchInput} onChange={(event) => { setSearchInput(event.target.value); setPage(1); }} placeholder="Search deletion requests…" aria-label="Search deletion requests" title="Search by username, email or user ID" className="input-control" /></div>
        <span className="deletion-result-count" role="status">{isFetching && !isLoading ? 'Updating requests…' : data ? `${data.pagination.total.toLocaleString()} matching requests` : ''}</span>
      </div>

      {isLoading ? <LoadingState label="Loading deletion requests…" /> : isError ? (
        <div className="deletion-empty" role="alert"><AlertTriangle size={32} /><h3>Requests could not be loaded</h3><p>{(error as Error)?.message || 'Try loading the deletion queue again.'}</p><button type="button" className="btn-secondary" onClick={() => refetch()} disabled={isFetching}>Try again</button></div>
      ) : requests.length === 0 ? (
        <div className="deletion-empty"><CheckCircle size={34} /><h3>No matching requests</h3><p>No account-deletion requests match these filters.</p></div>
      ) : (
        <div className="deletion-list" aria-busy={busy || isFetching}>
          {requests.map((req) => (
            <RequestRow
              key={req.userId}
              request={req}
              busy={busy || isFetching}
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
                description: `This permanently purges all data for @${req.username} right now, without waiting for the scheduled sweep.`,
                consequences: [
                  'The user cannot recover this account after this step.',
                  'Their posts, activities and profile are removed immediately.',
                ],
                severity: 'critical',
                confirmLabel: 'Delete immediately',
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
        busy={busy || isFetching}
      />
    </div>
  );
};

const StatTile: React.FC<{ icon: React.ReactNode; label: string; value?: number; tone: string }> = ({ icon, label, value, tone }) => (
  <div className={`deletion-stat tone-${tone}`}><dt><span>{label}</span>{icon}</dt><dd>{value == null ? '—' : value.toLocaleString()}</dd></div>
);

const RequestRow: React.FC<{ request: DeletionRequest; busy: boolean; onRestore: () => void; onPurge: () => void }> = ({ request, busy, onRestore, onPurge }) => (
  <article className="deletion-card" aria-label={`Deletion request for ${request.username || request.userId}`}>
    <header className="deletion-card-header">
      <div className="deletion-person"><h3>{request.username ? `@${request.username}` : 'Deleted account'}</h3><p>{request.email || 'Email unavailable'}</p>{request.college && <span>{request.college}</span>}</div>
      <div className="deletion-state"><span className={`deletion-status is-${request.status}`}>{STATUS_LABELS[request.status]}</span>{request.status !== 'completed' && <small>{request.purgeInProgress ? 'Deletion in progress' : request.dueNow ? 'Due now' : request.daysRemaining == null ? 'No deadline recorded' : `${request.daysRemaining} day${request.daysRemaining === 1 ? '' : 's'} left`}</small>}</div>
    </header>
    <dl className="deletion-dates"><Field label="Requested" value={formatDate(request.deletionRequestedAt)} /><Field label={request.status === 'completed' ? 'Deleted' : 'Scheduled deletion'} value={formatDate(request.status === 'completed' ? request.purgeCompletedAt : request.scheduledPurgeAt)} /></dl>
    <div className="deletion-user-id"><span>User ID</span><code>{request.userId}</code></div>
    {request.purgeLastError && <details className="deletion-failure"><summary><AlertTriangle size={15} />Last failure · {request.purgeAttempts} attempt{request.purgeAttempts === 1 ? '' : 's'}</summary><p>{request.purgeLastError}</p></details>}
    {(request.canRestore || request.canPurgeNow) && <footer className="deletion-card-actions">
      {request.canRestore && <button type="button" onClick={onRestore} disabled={busy} className="btn-secondary"><UserCheck size={17} /><span>Restore account</span></button>}
      {request.canPurgeNow && <button type="button" onClick={onPurge} disabled={busy} className="btn-danger"><Trash2 size={17} /><span>Delete permanently</span></button>}
    </footer>}
  </article>
);
const Field: React.FC<{ label: string; value: string }> = ({ label, value }) => <div><dt>{label}</dt><dd>{value}</dd></div>;

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export default AccountDeletionPage;
