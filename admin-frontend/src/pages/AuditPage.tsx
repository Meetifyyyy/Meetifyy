import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../api/apiClient';
import { AlertTriangle, Clock, FileText, Key, RefreshCw, ShieldAlert } from '../components/icons';
import { Pagination } from '../components/Pagination';
import { LoadingState } from '../components/LoadingState';
import { formatEnumLabel } from '../utils/formatEnumLabel';
import './activity.css';

type AuditTab = 'AUDIT' | 'SECURITY' | 'LOGIN';
const sections = [
  { value: 'AUDIT', label: 'Admin actions', title: 'Admin operations', description: 'Recorded changes made in the admin portal.', endpoint: 'logs', key: 'adminAuditLogs', icon: FileText },
  { value: 'SECURITY', label: 'Security events', title: 'Security events', description: 'Recorded security signals and their event details.', endpoint: 'security-events', key: 'adminSecurityEvents', icon: ShieldAlert },
  { value: 'LOGIN', label: 'Sign-in history', title: 'Sign-in history', description: 'Successful and unsuccessful attempts to access the admin portal.', endpoint: 'login-audits', key: 'adminLoginAudits', icon: Key },
] as const;
interface AuditEntry {
  id: string;
  createdAt: string;
  ip?: string | null;
  action?: string;
  type?: string;
  admin?: { name?: string | null; email?: string | null } | null;
  adminId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: unknown;
  email?: string;
  success?: boolean;
  failureReason?: string | null;
  browser?: string | null;
  os?: string | null;
  deviceName?: string | null;
}
interface AuditResponse { data: AuditEntry[]; meta: { total: number; page: number; totalPages: number } }
const columns = {
  AUDIT: ['Action', 'Administrator', 'Target', 'IP address', 'Recorded'],
  SECURITY: ['Event', 'IP address', 'Details', 'Recorded'],
  LOGIN: ['Account', 'Result', 'Device', 'IP address', 'Recorded'],
};
const recordedAt = (value: string) => new Date(value).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const reasonLabel = (reason?: string | null) => reason ? /^[A-Z0-9_]+$/.test(reason) ? formatEnumLabel(reason) : reason : 'No reason recorded';

function EntryCells({ entry, tab }: { entry: AuditEntry; tab: AuditTab }) {
  const ip = <code className="activity-code">{entry.ip || 'Not recorded'}</code>;
  const recorded = <time dateTime={entry.createdAt}>{recordedAt(entry.createdAt)}</time>;
  if (tab === 'AUDIT') return <>
    <td data-label="Action"><span className="activity-badge tone-blue" title={entry.action}>{formatEnumLabel(entry.action) || 'Unknown action'}</span></td>
    <td data-label="Administrator"><strong className="audit-actor">{entry.admin?.name || entry.admin?.email || entry.adminId || 'Not recorded'}</strong></td>
    <td data-label="Target"><span className="audit-target-type">{formatEnumLabel(entry.targetType) || 'Not recorded'}</span>{entry.targetId && <code className="activity-code audit-target-id">{entry.targetId}</code>}</td>
    <td data-label="IP address">{ip}</td><td data-label="Recorded">{recorded}</td>
  </>;
  if (tab === 'SECURITY') return <>
    <td data-label="Event"><span className="activity-badge tone-violet" title={entry.type}>{formatEnumLabel(entry.type) || 'Security event'}</span></td>
    <td data-label="IP address">{ip}</td>
    <td data-label="Details">{entry.metadata == null ? <span className="activity-muted">No metadata recorded</span> : <details className="audit-event-details"><summary>View metadata</summary><pre tabIndex={0} aria-label="Event metadata">{JSON.stringify(entry.metadata, null, 2)}</pre></details>}</td>
    <td data-label="Recorded">{recorded}</td>
  </>;
  return <>
    <td data-label="Account"><strong className="audit-actor">{entry.email || entry.admin?.email || 'Email not recorded'}</strong>{entry.admin?.name && <small className="audit-secondary">{entry.admin.name}</small>}</td>
    <td data-label="Result"><span className={`activity-badge ${entry.success ? 'tone-green' : 'tone-rose'}`}>{entry.success ? 'Successful' : 'Failed'}</span>{!entry.success && <small className="audit-secondary">{reasonLabel(entry.failureReason)}</small>}</td>
    <td data-label="Device"><span>{entry.browser || 'Unknown browser'}</span><small className="audit-secondary">{entry.os || 'Unknown system'}</small></td>
    <td data-label="IP address">{ip}</td><td data-label="Recorded">{recorded}</td>
  </>;
}

export const AuditPage: React.FC = () => {
  const [tab, setTab] = useState<AuditTab>('AUDIT');
  const [page, setPage] = useState(1);
  const section = sections.find((item) => item.value === tab)!;
  const Icon = section.icon;
  const query = useQuery<AuditResponse>({ queryKey: [section.key, page], queryFn: () => apiRequest(`/admin/audit/${section.endpoint}?page=${page}`) });
  useEffect(() => { if (query.data && page > Math.max(1, query.data.meta.totalPages)) setPage(Math.max(1, query.data.meta.totalPages)); }, [query.data, page]);
  return (
    <div className="admin-page audit-page">
      <header className="page-header"><div><h2 className="page-title">Audit Logs</h2><p className="page-subtitle">Admin operations, security events, and sign-in history.</p></div><button type="button" className="btn-secondary activity-refresh" aria-label="Refresh audit logs" title="Refresh logs" onClick={() => query.refetch()} disabled={query.isFetching}><RefreshCw size={17} className={query.isFetching ? 'spin' : undefined} /><span>Refresh logs</span></button></header>
      <section className={`activity-overview ${tab === 'SECURITY' ? 'tone-violet' : tab === 'LOGIN' ? 'tone-green' : 'tone-blue'}`} aria-label={section.title}>
        <span className="activity-overview-icon"><Icon size={25} /></span><div><h3>{section.title}</h3><p>{section.description}</p></div><div className="activity-overview-count" aria-live="polite"><strong>{query.isLoading || query.isError ? '—' : (query.data?.meta.total ?? 0).toLocaleString()}</strong><span>recorded entries</span></div>
      </section>
      <div className="audit-toolbar"><div className="audit-section-tabs" role="group" aria-label="Audit category">{sections.map(({ value, label }) => <button type="button" key={value} aria-pressed={tab === value} onClick={() => { setTab(value); setPage(1); }}>{label}</button>)}</div><span className="activity-sort"><Clock size={14} />Newest first</span></div>
      {query.isLoading ? <LoadingState label={`Loading ${section.label.toLowerCase()}…`} /> : query.isError ? <div className="activity-state" role="alert"><AlertTriangle size={30} /><h3>Logs could not be loaded</h3><p>{(query.error as Error)?.message || 'Try loading these entries again.'}</p><button type="button" className="btn-secondary" onClick={() => query.refetch()} disabled={query.isFetching}>Try again</button></div> : !query.data?.data.length ? <div className="activity-state"><Icon size={30} /><h3>No entries recorded</h3><p>{section.label} will appear here as events are recorded.</p></div> : (
        <div className="audit-table-wrap" aria-busy={query.isFetching}><table className={`audit-table is-${tab.toLowerCase()}`} aria-label={section.label}><thead><tr>{columns[tab].map((label) => <th key={label}>{label}</th>)}</tr></thead><tbody>{query.data.data.map((entry) => <tr key={entry.id}><EntryCells entry={entry} tab={tab} /></tr>)}</tbody></table></div>
      )}
      {!query.isError && <div className="activity-pagination"><Pagination page={page} totalPages={query.data?.meta.totalPages} total={query.data?.meta.total} onChange={setPage} label="entries" busy={query.isFetching} /></div>}
    </div>
  );
};
