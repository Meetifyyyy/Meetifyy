import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../api/apiClient';
import { AlertTriangle, CheckCircle, Clock, Mail, RefreshCw, ShieldCheck, X, XCircle } from '../components/icons';
import { useConfirm } from '../components/ConfirmProvider';
import { LoadingState } from '../components/LoadingState';
import { Pagination } from '../components/Pagination';
import { formatEnumLabel } from '../utils/formatEnumLabel';
import UserAvatar from '../components/UserAvatar';
import VerificationDocument, { type ReviewerDocument } from './VerificationDocument';
import './verification.css';

const PAGE_SIZE = 20;
const REASON_MAX = 500;
const filters = [
  { value: 'PENDING', label: 'Pending', heading: 'Awaiting review', description: 'Review the submitted photos and previous attempts before making a decision.' },
  { value: 'ALL', label: 'All requests', heading: 'All verification requests', description: 'Browse identity submissions and their recorded review outcomes.' },
  { value: 'VERIFIED', label: 'Verified', heading: 'Verified requests', description: 'Identity submissions that have been approved.' },
  { value: 'REJECTED', label: 'Rejected', heading: 'Rejected requests', description: 'Review declined submissions and the reasons recorded for students.' },
] as const;
type Filter = typeof filters[number]['value'];
interface Attempt {
  id: string;
  status: string;
  attemptNumber?: number;
  rejectionReason?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
}
interface VerificationRequest extends Attempt {
  method?: string | null;
  user?: { id?: string; displayName?: string | null; username?: string | null; email?: string | null; avatar?: string | null } | null;
  previousAttempts?: Attempt[];
  idCardMedia?: ReviewerDocument | null;
  selfieMedia?: ReviewerDocument | null;
}
interface RequestsResponse { total: number; requests: VerificationRequest[] }
const personName = (request: VerificationRequest) => request.user?.displayName || request.user?.username || 'Student';
const dateLabel = (value?: string | null) => value ? new Date(value).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Not recorded';
const statusClass = (status: string) => status === 'PENDING' ? 'badge-warning' : status === 'VERIFIED' ? 'badge-success' : status === 'REJECTED' ? 'badge-danger' : 'badge-neutral';
const methodLabel = (method?: string | null) => method === 'LIVE_GOVERNMENT_ID' ? 'Live government ID' : method === 'LIVE_SELFIE' ? 'Live selfie' : method ? formatEnumLabel(method) : 'ID card & selfie';

function RejectVerificationDialog({ request, pending, error, onClose, onReject }: {
  request: VerificationRequest;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onReject: (reason: string) => Promise<unknown>;
}) {
  const [reason, setReason] = useState('');
  const dialogRef = useRef<HTMLFormElement>(null);
  const actions = useRef({ pending, onClose });
  useEffect(() => { actions.current = { pending, onClose }; }, [pending, onClose]);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLTextAreaElement>('textarea')?.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !actions.current.pending) { event.preventDefault(); actions.current.onClose(); }
      if (event.key !== 'Tab' || !dialog) return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>('*')).filter((node) => node.matches('button:not(:disabled), textarea:not(:disabled)'));
      if (!controls.length) { event.preventDefault(); dialog.focus(); return; }
      const first = controls[0]; const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!reason.trim() || pending) return;
    try { await onReject(reason.trim()); onClose(); } catch { /* The mutation error is displayed with the retained draft below. */ }
  };
  return createPortal(
    <div className="modal-backdrop verification-reject-backdrop" onClick={(event) => { if (event.target === event.currentTarget && !pending) onClose(); }}>
      <form ref={dialogRef} tabIndex={-1} className="modal-content dialog-form admin-dialog-layout verification-reject-dialog" role="dialog" aria-modal="true" aria-labelledby="reject-verification-title" aria-describedby="reject-verification-description" aria-busy={pending} onSubmit={submit}>
        <header className="dialog-header">
          <div><h3 id="reject-verification-title">Reject verification</h3><p className="verification-dialog-person">{personName(request)}</p></div>
          <button type="button" className="dialog-close" aria-label="Close rejection editor" onClick={onClose} disabled={pending}><X size={18} /></button>
        </header>
        <div className="admin-dialog-body">
          <p id="reject-verification-description" className="verification-dialog-description">The student will see this reason. Explain what needs to change so they can submit a clearer verification.</p>
          <label className="verification-reason-label" htmlFor="reject-verification-reason">Reason for rejection</label>
          <textarea id="reject-verification-reason" className="input-control" required value={reason} maxLength={REASON_MAX} disabled={pending} onChange={(event) => setReason(event.target.value)} placeholder="Explain which details are unclear or need to be corrected…" rows={5} aria-describedby="verification-reason-hint verification-reason-count" />
          <div className="verification-reason-footer"><span id="verification-reason-hint">A reason is required.</span><span id="verification-reason-count">{reason.length}/{REASON_MAX}</span></div>
          {error && <div className="verification-error" role="alert"><AlertTriangle size={18} /><span>{error}</span></div>}
        </div>
        <footer className="modal-actions">
          <button type="button" className="btn-secondary" disabled={pending} onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-danger" disabled={!reason.trim() || pending}>{pending ? 'Rejecting…' : 'Confirm rejection'}</button>
        </footer>
      </form>
    </div>, document.body,
  );
}

export const VerificationPage: React.FC = () => {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Filter>('PENDING');
  const [page, setPage] = useState(1);
  const [rejecting, setRejecting] = useState<VerificationRequest | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const selectedFilter = filters.find((filter) => filter.value === status)!;
  const query = useQuery<RequestsResponse>({
    queryKey: ['adminVerificationRequests', status, page],
    queryFn: () => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE) });
      if (status !== 'ALL') params.set('status', status);
      return apiRequest(`/admin/verification/requests?${params}`);
    },
    refetchOnWindowFocus: false,
  });
  const totalPages = Math.max(1, Math.ceil((query.data?.total ?? 0) / PAGE_SIZE));
  useEffect(() => { if (query.data && page > totalPages) setPage(totalPages); }, [query.data, page, totalPages]);
  const review = useMutation({
    mutationFn: ({ id, status: nextStatus, adminNotes }: { id: string; status: 'VERIFIED' | 'REJECTED'; adminNotes?: string }) => apiRequest(`/admin/verification/requests/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status: nextStatus, adminNotes }) }),
    onSuccess: async (_, decision) => {
      setNotice(decision.status === 'VERIFIED' ? 'Verification approved.' : 'Verification rejected. The reason has been recorded for the student.');
      await queryClient.invalidateQueries({ queryKey: ['adminVerificationRequests'] });
    },
  });
  const approve = (request: VerificationRequest) => confirm({
    title: request.user?.username ? `Approve verification for @${request.user.username}?` : 'Approve this verification?',
    description: 'The account is marked verified.',
    consequences: ['They gain access to messaging, campus surfaces and share or invite lists.'],
    severity: 'moderate', confirmLabel: 'Approve',
    onConfirm: () => review.mutateAsync({ id: request.id, status: 'VERIFIED' }),
  });
  const changeFilter = (value: Filter) => { if (review.isPending) return; setStatus(value); setPage(1); setNotice(null); };
  const busy = review.isPending || query.isFetching;
  const requests = query.data?.requests ?? [];

  return (
    <div className="admin-page verification-page">
      <header className="page-header">
        <div><h2 className="page-title">ID Verification</h2><p className="page-subtitle">Review identity submissions and manage verification decisions.</p></div>
        <button type="button" className="btn-secondary verification-refresh" aria-label="Refresh verification requests" title="Refresh requests" onClick={() => query.refetch()} disabled={busy}><RefreshCw size={17} className={query.isFetching ? 'spin' : undefined} /><span>Refresh requests</span></button>
      </header>
      <section className={`verification-overview tone-${status.toLowerCase()}`} aria-label={selectedFilter.heading}>
        <span className="verification-overview-icon"><ShieldCheck size={26} /></span>
        <div><h3>{selectedFilter.heading}</h3><p>{selectedFilter.description}</p></div>
        <div className="verification-overview-count" aria-live="polite"><strong>{query.isLoading || query.isError ? '—' : query.data?.total.toLocaleString() ?? '0'}</strong><span>requests</span></div>
      </section>
      <div className="verification-toolbar">
        <div className="verification-status-filters" role="group" aria-label="Verification status">
          {filters.map((filter) => <button type="button" key={filter.value} aria-pressed={status === filter.value} disabled={review.isPending} onClick={() => changeFilter(filter.value)}>{filter.label}</button>)}
        </div>
        <span className="verification-sort-label"><Clock size={14} />Newest first</span>
      </div>
      {notice && <div className="verification-notice" role="status"><CheckCircle size={18} /><span>{notice}</span><button type="button" aria-label="Dismiss verification update" onClick={() => setNotice(null)}><X size={16} /></button></div>}
      {query.isLoading ? <LoadingState label="Loading verification requests…" /> : query.isError ? (
        <div className="verification-empty"><AlertTriangle size={32} /><h3>Requests could not be loaded</h3><p>{(query.error as Error)?.message || 'Try loading the verification queue again.'}</p><button type="button" className="btn-secondary" onClick={() => query.refetch()} disabled={query.isFetching}>Try again</button></div>
      ) : requests.length === 0 ? (
        <div className="verification-empty"><ShieldCheck size={36} /><h3>{status === 'PENDING' ? 'All caught up' : 'No matching requests'}</h3><p>{status === 'PENDING' ? 'New identity submissions will appear here for review.' : 'There are no verification requests in this status.'}</p></div>
      ) : (
        <div className="verification-list" aria-busy={query.isFetching}>
          {requests.map((request) => (
            <article key={request.id} className="verification-card" aria-label={`Verification for ${personName(request)}`}>
              <header className="verification-identity">
                <UserAvatar user={request.user} size={44} />
                <div className="verification-person-name"><h3>{personName(request)}</h3>{request.user?.username && <span className="verification-username">@{request.user.username}</span>}</div>
                <span className={`badge ${statusClass(request.status)}`}>{formatEnumLabel(request.status)}</span>
              </header>
              {request.user?.email && <div className="verification-email"><Mail size={15} /><span>{request.user.email}</span></div>}
              <dl className="verification-request-meta">
                <div><dt>Submitted</dt><dd><time dateTime={request.createdAt}>{dateLabel(request.createdAt)}</time></dd></div>
                <div><dt>Verification method</dt><dd><span className="verification-method-value">{methodLabel(request.method)}</span>{request.attemptNumber != null && <span className="verification-attempt-number">Attempt {request.attemptNumber}</span>}</dd></div>
              </dl>
              <div className={`verification-media-grid${request.method ? ' is-single' : ''}`}>
                {request.method !== 'LIVE_SELFIE' && <VerificationDocument requestId={request.id} kind="idCard" label={request.method === 'LIVE_GOVERNMENT_ID' ? 'Government ID' : 'College ID card'} alt={request.method === 'LIVE_GOVERNMENT_ID' ? 'Government ID' : 'College ID card'} emptyText="No ID document available" media={request.idCardMedia} issuedAt={query.dataUpdatedAt} />}
                {request.method !== 'LIVE_GOVERNMENT_ID' && <VerificationDocument requestId={request.id} kind="selfie" label="Live selfie" alt="Live selfie" emptyText="No selfie available" media={request.selfieMedia} issuedAt={query.dataUpdatedAt} />}
              </div>
              {(request.rejectionReason || request.reviewedAt) && <div className="verification-outcome">{request.rejectionReason && <><span className="verification-field-caption">Recorded reason</span><p>{request.rejectionReason}</p></>}{request.reviewedAt && <span>Reviewed {dateLabel(request.reviewedAt)}</span>}</div>}
              {!!request.previousAttempts?.length && <details className="verification-history"><summary>Previous attempts <span>{request.previousAttempts.length}</span></summary><ol>{request.previousAttempts.map((attempt) => <li key={attempt.id}><div><strong>Attempt {attempt.attemptNumber ?? '—'}</strong><span className={`badge ${statusClass(attempt.status)}`}>{formatEnumLabel(attempt.status)}</span></div><p>{attempt.rejectionReason || 'No reason recorded'}</p><time dateTime={attempt.reviewedAt || attempt.createdAt}>{dateLabel(attempt.reviewedAt || attempt.createdAt)}</time></li>)}</ol></details>}
              {request.status === 'PENDING' && <footer className="verification-actions"><button type="button" className="btn-secondary verification-reject" disabled={busy} onClick={() => { review.reset(); setNotice(null); setRejecting(request); }}><XCircle size={17} /><span>Reject</span></button><button type="button" className="btn-primary verification-approve" disabled={busy} onClick={() => approve(request)}><CheckCircle size={17} /><span>Approve</span></button></footer>}
            </article>
          ))}
        </div>
      )}
      {!query.isLoading && !query.isError && <Pagination page={page} totalPages={totalPages} total={query.data?.total} label="requests" onChange={setPage} busy={busy} />}
      {rejecting && <RejectVerificationDialog key={rejecting.id} request={rejecting} pending={review.isPending} error={review.isError ? (review.error as Error)?.message || 'Could not reject this request.' : null} onClose={() => setRejecting(null)} onReject={(reason) => review.mutateAsync({ id: rejecting.id, status: 'REJECTED', adminNotes: reason })} />}
    </div>
  );
};
