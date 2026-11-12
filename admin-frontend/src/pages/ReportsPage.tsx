import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../api/apiClient';
import { Eye, EyeOff, X, Search, ShieldCheck, Clock, CheckCircle, AlertCircle, RefreshCw, FileText } from '../components/icons';
import { Dropdown } from '../components/Dropdown';
import { Pagination } from '../components/Pagination';
import { LoadingState } from '../components/LoadingState';
import { useConfirm } from '../components/ConfirmProvider';
import { useDebounced } from '../hooks/useDebounced';
import UserAvatar from '../components/UserAvatar';
import { formatEnumLabel } from '../utils/formatEnumLabel';
import { formatDateTime } from './legal/legalFormat';
import './moderation.css';

interface ReportRow {
  id: string; targetType: string; targetId: string; reason: string; priority: string; status: string; description?: string | null; createdAt?: string;
  reporter?: { username: string; displayName?: string | null; avatar?: string | null; email?: string } | null;
}
interface ReportDetail extends ReportRow { internalNotes?: string | null; resolution?: string | null; targetContent?: unknown; }
const STATUSES = [
  { id: 'PENDING', label: 'Pending' }, { id: 'UNDER_REVIEW', label: 'Under review' },
  { id: 'RESOLVED', label: 'Resolved' }, { id: 'REJECTED', label: 'Dismissed' }, { id: '', label: 'All reports' },
];
const statusLabel = (status: string) => STATUSES.find((item) => item.id === status)?.label || formatEnumLabel(status);
const ReportPill: React.FC<{ value: string; priority?: boolean }> = ({ value, priority = false }) => (
  <span className={`moderation-pill ${priority ? 'priority' : 'status'}-${value.toLowerCase()}`}>{priority ? formatEnumLabel(value) : statusLabel(value)}</span>
);
const ModerationError: React.FC<{ message: string; retry: () => void }> = ({ message, retry }) => (
  <div className="moderation-error" role="alert"><AlertCircle size={18} aria-hidden="true" /><span>{message}</span><button className="btn-secondary" onClick={retry}><RefreshCw size={16} />Try again</button></div>
);

interface ConfessionAuthor { id: string; username: string; displayName: string; avatar?: string | null }
const REVEAL_REASON_MIN = 10;
const REVEAL_REASON_MAX = 500;

/**
 * A confession's author stays hidden in the report view. Seeing the account
 * takes a stated reason, which the server stores in the audit log, so the
 * identity is held only in this component's state and is gone when the review
 * closes.
 */
const ConfessionAuthorReveal: React.FC<{ reportId: string; handle?: string }> = ({ reportId, handle }) => {
  const [formOpen, setFormOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [author, setAuthor] = useState<ConfessionAuthor | null>(null);
  const reveal = useMutation({
    mutationFn: (text: string) => apiRequest<{ author: ConfessionAuthor }>(`/admin/reports/${reportId}/reveal-author`, { method: 'POST', body: JSON.stringify({ reason: text }) }),
    onSuccess: (result) => { setAuthor(result.author); setFormOpen(false); setReason(''); },
  });
  const trimmed = reason.trim();
  const valid = trimmed.length >= REVEAL_REASON_MIN && trimmed.length <= REVEAL_REASON_MAX;
  const closeForm = () => { setFormOpen(false); setReason(''); reveal.reset(); };

  return <div className="moderation-author" aria-label="Confession author">
    <span className="moderation-field-caption">Posted anonymously{handle ? <> as <strong>{handle}</strong></> : null}</span>
    {author ? <div className="moderation-person" role="status"><UserAvatar user={author} size={36} /><div><strong>{author.displayName || author.username}</strong><span>@{author.username}</span><span>User ID {author.id}</span></div></div>
      : formOpen ? <form className="moderation-reveal-form" onSubmit={(event) => { event.preventDefault(); if (valid && !reveal.isPending) reveal.mutate(trimmed); }}
        onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!reveal.isPending) closeForm(); } }}>
        <div className="moderation-review-field">
          <label htmlFor="reveal-author-reason">Reason for revealing the author <small>{trimmed.length}/{REVEAL_REASON_MAX}</small></label>
          <textarea id="reveal-author-reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={REVEAL_REASON_MAX} rows={3} className="input-control" placeholder="Why this account needs to be identified" disabled={reveal.isPending} autoFocus />
          <p className="moderation-field-help">At least {REVEAL_REASON_MIN} characters. The reason and your admin account are recorded in the audit log.</p>
        </div>
        {reveal.isError && <div className="moderation-error" role="alert"><AlertCircle size={18} aria-hidden="true" /><span>{(reveal.error as Error).message || 'Could not reveal the author.'}</span></div>}
        <div className="moderation-reveal-actions"><button type="button" className="btn-secondary" onClick={closeForm} disabled={reveal.isPending}>Cancel</button><button type="submit" className="btn-primary" disabled={!valid || reveal.isPending}>{reveal.isPending ? 'Revealing…' : 'Reveal author'}</button></div>
      </form>
      : <><button type="button" className="btn-secondary moderation-reveal-button" onClick={() => setFormOpen(true)}><EyeOff size={16} aria-hidden="true" />Reveal author</button><p className="moderation-field-help">The author is hidden by default. Revealing needs a reason and is audited.</p></>}
  </div>;
};

const ReportReviewEditor: React.FC<{ report: ReportDetail; onClose: () => void }> = ({ report, onClose }) => {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [internalNotes, setInternalNotes] = useState(report.internalNotes || '');
  const [resolution, setResolution] = useState(report.resolution || '');
  const update = useMutation({
    mutationFn: (status: 'RESOLVED' | 'REJECTED') => apiRequest(`/admin/reports/${report.id}`, { method: 'PATCH', body: JSON.stringify({ status, resolution, internalNotes }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminReports'] });
      queryClient.invalidateQueries({ queryKey: ['adminReportStats'] });
      queryClient.invalidateQueries({ queryKey: ['dashboardStats'] });
      onClose();
    },
  });
  const requestDecision = (status: 'RESOLVED' | 'REJECTED') => confirm({
    title: status === 'RESOLVED' ? 'Resolve this report?' : 'Dismiss this report?',
    description: status === 'RESOLVED' ? 'The report is closed and your resolution and internal notes are saved.' : 'The report is closed without action against the reported content or account.',
    consequences: status === 'RESOLVED' ? ['This records the outcome. It does not automatically remove content or restrict an account.'] : ['The reporter is not told why it was dismissed.'],
    severity: 'moderate', confirmLabel: status === 'RESOLVED' ? 'Resolve report' : 'Dismiss report',
    onConfirm: () => update.mutateAsync(status),
  });
  const content = report.targetContent && typeof report.targetContent === 'object' ? report.targetContent as Record<string, unknown> : null;
  const preview = typeof report.targetContent === 'string' ? report.targetContent : [content?.text, content?.description, content?.bio].find((value): value is string => typeof value === 'string' && Boolean(value));
  const confessionHandle = report.targetType === 'CONFESSION' && content?.profile && typeof content.profile === 'object' && typeof (content.profile as Record<string, unknown>).handle === 'string' ? (content.profile as { handle: string }).handle : undefined;
  const contentTitle = [content?.displayName, content?.name, content?.username].find((value): value is string => typeof value === 'string' && Boolean(value));

  return <>
    <div className="admin-dialog-body moderation-review-body">
      <section className="moderation-report-content" aria-labelledby="moderation-content-title">
        <div className="moderation-report-tags"><span className="moderation-target">{formatEnumLabel(report.targetType)}</span><ReportPill value={report.priority} priority /><ReportPill value={report.status} /></div>
        <p className="moderation-field-caption">Reported for</p><h4 className="moderation-report-reason">{formatEnumLabel(report.reason)}</h4>
        {report.description && <div className="moderation-description"><h5>Reporter’s description</h5><p>{report.description}</p></div>}
        <div className="moderation-content-preview"><h4 id="moderation-content-title"><FileText size={17} aria-hidden="true" />Reported content</h4>
          {report.targetContent == null ? <p className="moderation-muted">Reported content is no longer available.</p> : <>
            {contentTitle && <strong>{contentTitle}</strong>}
            {preview && <p className="moderation-content-text">{preview}</p>}
            {!preview && !contentTitle && <p className="moderation-muted">Content details are available below.</p>}
            {report.targetType === 'CONFESSION' && <ConfessionAuthorReveal reportId={report.id} handle={confessionHandle} />}
            <details className="moderation-content-data"><summary>View content data</summary><pre tabIndex={0} aria-label="Reported content data">{JSON.stringify(report.targetContent, null, 2)}</pre></details>
          </>}
        </div>
      </section>
      <section className="moderation-review-details" aria-labelledby="moderation-decision-title">
        <div className="moderation-reporter-detail"><span className="moderation-field-caption">Reported by</span>
          {report.reporter ? <div className="moderation-person"><UserAvatar user={report.reporter} size={36} /><div><strong>{report.reporter.displayName || report.reporter.username}</strong><span>@{report.reporter.username}</span></div></div> : <p className="moderation-muted">Reporter unavailable</p>}
          <dl className="moderation-case-meta"><div><dt>Submitted</dt><dd>{formatDateTime(report.createdAt)}</dd></div><div><dt>Report ID</dt><dd>{report.id}</dd></div></dl>
        </div>
        <h4 id="moderation-decision-title">Review decision</h4>
        <div className="moderation-review-field"><label htmlFor="report-admin-notes">Internal admin notes <small>{internalNotes.length}/2,000</small></label><textarea id="report-admin-notes" value={internalNotes} onChange={(event) => setInternalNotes(event.target.value)} maxLength={2000} rows={3} className="input-control" placeholder="Context for the moderation team" disabled={update.isPending} /></div>
        <div className="moderation-review-field"><label htmlFor="report-resolution">Resolution <small>{resolution.length}/500</small></label><textarea id="report-resolution" value={resolution} onChange={(event) => setResolution(event.target.value)} maxLength={500} rows={2} className="input-control" placeholder="Describe the decision or action already taken" disabled={update.isPending} /><p className="moderation-field-help">Records the outcome; content and account actions are managed separately.</p></div>
      </section>
    </div>
    <div className="modal-actions moderation-review-actions"><button onClick={onClose} className="btn-secondary" disabled={update.isPending}>Cancel</button><button onClick={() => requestDecision('REJECTED')} className="btn-secondary moderation-dismiss" disabled={update.isPending}>Dismiss report</button><button onClick={() => requestDecision('RESOLVED')} className="btn-primary" disabled={update.isPending}>Resolve report</button></div>
  </>;
};

const ReportReviewDialog: React.FC<{ reportId: string; onClose: () => void }> = ({ reportId, onClose }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const { data: report, isLoading, isFetching, error, refetch } = useQuery<ReportDetail>({
    queryKey: ['adminReport', reportId], queryFn: () => apiRequest(`/admin/reports/${reportId}`),
    gcTime: 0, staleTime: Infinity, refetchOnWindowFocus: false,
  });
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLElement>('.dialog-close')?.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (document.querySelector('[role="alertdialog"]')) return;
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key !== 'Tab' || !dialog) return;
      // Walk in document order and skip controls hidden inside collapsed content.
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>('*')).filter((node) =>
        node.matches('button:not(:disabled), textarea:not(:disabled), input:not(:disabled), summary, [tabindex="0"]') &&
        !node.closest('[hidden]') && (!node.closest('details:not([open])') || node.tagName === 'SUMMARY'),
      );
      const first = controls[0]; const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }); };
  }, [onClose]);
  return createPortal(<div className="modal-backdrop" onClick={onClose}>
    <div ref={dialogRef} className="modal-content dialog-form admin-dialog-layout moderation-review-modal" role="dialog" aria-modal="true" aria-labelledby="report-review-title" onClick={(event) => event.stopPropagation()}>
      <div className="dialog-header"><div><h3 id="report-review-title">Review report</h3><p className="moderation-dialog-reference">Case #{reportId.slice(0, 8)}</p></div><button onClick={onClose} className="dialog-close" aria-label="Close report review"><X size={18} /></button></div>
      {isLoading || (isFetching && !report) ? <div className="admin-dialog-body"><LoadingState label="Loading report details…" compact /></div> : error || !report ? <div className="admin-dialog-body"><ModerationError message={(error as Error | null)?.message || 'Could not load report details.'} retry={() => refetch()} /></div> : <ReportReviewEditor report={report} onClose={onClose} />}
    </div>
  </div>, document.body);
};

export const ReportsPage: React.FC = () => {
  const [statusFilter, setStatusFilter] = useState('PENDING');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const debouncedSearch = useDebounced(search.trim(), 300);
  const [page, setPage] = useState(1);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const closeReview = useCallback(() => setSelectedReportId(null), []);
  useEffect(() => { setPage(1); }, [statusFilter, priorityFilter, debouncedSearch]);
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['adminReports', statusFilter, priorityFilter, debouncedSearch, page],
    queryFn: () => {
      const params = new URLSearchParams({ status: statusFilter, priority: priorityFilter, page: String(page) });
      if (debouncedSearch) params.set('search', debouncedSearch);
      return apiRequest(`/admin/reports?${params}`);
    }, refetchInterval: 30_000,
  });
  const { data: stats, isLoading: statsLoading, error: statsError, refetch: refetchStats } = useQuery<{ byStatus: Record<string, number>; total: number }>({ queryKey: ['adminReportStats'], queryFn: () => apiRequest('/admin/reports/stats'), refetchInterval: 30_000 });
  useEffect(() => { if (data?.meta?.totalPages !== undefined && page > Math.max(1, data.meta.totalPages)) setPage(Math.max(1, data.meta.totalPages)); }, [data?.meta?.totalPages, page]);
  const reports: ReportRow[] = data?.data ?? [];

  return <div className="admin-page moderation-page">
    <div className="page-header"><div><h2 className="page-title">Moderation Queue</h2><p className="page-subtitle">Review reported content and record moderation decisions.</p></div></div>
    <div className="moderation-summary" aria-label="Report totals across all filters">{[
      { status: 'PENDING', label: 'Pending reports', tone: 'blue', icon: Clock }, { status: 'UNDER_REVIEW', label: 'Under review', tone: 'violet', icon: Eye },
      { status: 'RESOLVED', label: 'Resolved reports', tone: 'green', icon: ShieldCheck }, { status: 'REJECTED', label: 'Dismissed reports', tone: 'peach', icon: CheckCircle },
    ].map(({ status, label, tone, icon: Icon }) => <dl key={status} className={`moderation-stat tone-${tone}`}><dt><span>{label}</span><Icon size={20} aria-hidden="true" /></dt><dd>{statsLoading ? '…' : !stats ? '—' : (stats.byStatus[status] ?? 0).toLocaleString()}</dd></dl>)}</div>
    {statsError && <ModerationError message="Report totals are unavailable." retry={() => refetchStats()} />}
    <div className="moderation-queue-heading"><h3>Report directory</h3><span role="status">{isFetching ? 'Updating reports…' : !data ? 'Report list unavailable' : `${data.meta.total.toLocaleString()} matching reports`}</span></div>
    <div className="moderation-status-tabs" aria-label="Filter reports by status">{STATUSES.map((item) => <button key={item.id} onClick={() => { setStatusFilter(item.id); setPage(1); }} aria-pressed={statusFilter === item.id}>{item.label}</button>)}</div>
    <div className="moderation-toolbar">
      <div className="moderation-search"><Search size={18} aria-hidden="true" /><input ref={searchRef} type="search" className="input-control" placeholder="Search reports…" aria-label="Search reports by reporter, description, or target ID" autoCapitalize="none" spellCheck={false} value={search} onChange={(event) => setSearch(event.target.value)} />{search && <button aria-label="Clear report search" onClick={() => { setSearch(''); searchRef.current?.focus({ preventScroll: true }); }}><X size={17} /></button>}</div>
      <div className="moderation-status-filter"><Dropdown aria-label="Filter reports by status" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }}>{STATUSES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</Dropdown></div>
      <div className="moderation-priority-filter"><Dropdown aria-label="Filter reports by priority" value={priorityFilter} onChange={(event) => { setPriorityFilter(event.target.value); setPage(1); }}><option value="">All priorities</option>{['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((priority) => <option key={priority} value={priority}>{formatEnumLabel(priority)}</option>)}</Dropdown></div>
    </div>
    {error && <ModerationError message={(error as Error).message || 'Could not load reports.'} retry={() => refetch()} />}
    <div className="moderation-list-panel" aria-busy={isFetching}>
      {isLoading ? <LoadingState label="Loading reports…" /> : !reports.length ? <div className="moderation-empty"><ShieldCheck size={30} aria-hidden="true" /><h4>{error ? 'Reports unavailable' : 'No matching reports'}</h4><p>{error ? 'Try loading the queue again.' : 'There are no reports matching the selected filters.'}</p></div> : <table className="moderation-table" role="table" aria-label="Moderation reports">
        <thead role="rowgroup"><tr role="row"><th role="columnheader">Report</th><th role="columnheader">Reporter</th><th role="columnheader">Priority</th><th role="columnheader">Status</th><th role="columnheader">Submitted</th><th role="columnheader">Review</th></tr></thead>
        <tbody role="rowgroup">{reports.map((report) => <tr role="row" key={report.id}>
          <td role="cell" className="report-cell-reason"><strong>{formatEnumLabel(report.reason)}</strong><div className="moderation-report-reference"><span className="moderation-target">{formatEnumLabel(report.targetType)}</span><span title={report.id}>#{report.id.slice(0, 8)}</span></div></td>
          <td role="cell" className="report-cell-reporter">{report.reporter ? <div className="moderation-person"><UserAvatar user={report.reporter} size={32} /><div><strong>{report.reporter.displayName || report.reporter.username}</strong><span>@{report.reporter.username}</span></div></div> : <span className="moderation-muted">Reporter unavailable</span>}</td>
          <td role="cell" className="report-cell-priority"><ReportPill value={report.priority} priority /></td><td role="cell" className="report-cell-status"><ReportPill value={report.status} /></td>
          <td role="cell" className="report-cell-date"><time dateTime={report.createdAt}>{formatDateTime(report.createdAt)}</time></td>
          <td role="cell" className="report-cell-action"><button className="moderation-review-button" onClick={() => setSelectedReportId(report.id)} aria-label={`Review report ${report.id}`} title="Review report"><Eye size={17} aria-hidden="true" /><span>Review</span></button></td>
        </tr>)}</tbody>
      </table>}
      <Pagination page={page} totalPages={data?.meta?.totalPages} total={data?.meta?.total} onChange={setPage} label="reports" busy={isFetching} />
    </div>
    {selectedReportId && <ReportReviewDialog reportId={selectedReportId} onClose={closeReview} />}
  </div>;
};
