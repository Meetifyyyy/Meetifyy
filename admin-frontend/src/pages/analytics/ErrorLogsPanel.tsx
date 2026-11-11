import React, { useEffect, useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Dropdown } from '../../components/Dropdown';
import { AlertTriangle, ShieldAlert, Search, X, ChevronDown } from '../../components/icons';
import { Pagination } from '../../components/Pagination';
import { LoadingState } from '../../components/LoadingState';
import { useDebounced } from '../../hooks/useDebounced';
import { AnalyticsError } from './AnalyticsError';
import { analyticsApi, type ErrorLogRow } from './analyticsApi';

function ago(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

export const ErrorLogsPanel: React.FC = () => {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const debouncedSearch = useDebounced(search.trim(), 300);
  const [severity, setSeverity] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => { setPage(1); setExpanded(null); }, [debouncedSearch, severity]);
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['adminErrorLogs', page, debouncedSearch, severity],
    queryFn: () => analyticsApi.getErrorLogs({ page, search: debouncedSearch || undefined, severity: severity || undefined }),
    refetchInterval: 30_000,
  });
  useEffect(() => {
    if (data?.pagination.pages !== undefined && page > Math.max(1, data.pagination.pages)) setPage(Math.max(1, data.pagination.pages));
  }, [data?.pagination.pages, page]);
  const rows: ErrorLogRow[] = data?.rows ?? [];
  const summary = data?.summary;
  const metric = (value: number | string | undefined) => isLoading ? '…' : !data ? '—' : typeof value === 'number' ? value.toLocaleString() : value ?? '—';

  return (
    <section className="analytics-error-section" aria-labelledby="analytics-error-title">
      <div className="analytics-section-heading"><div><h3 id="analytics-error-title">Application errors</h3><p>{summary ? `Recorded errors · ${summary.retentionDays}-day retention window` : 'Application errors recorded by the server.'}</p></div></div>
      {summary && !summary.captureEnabled && <div className="analytics-capture-notice"><AlertTriangle size={17} aria-hidden="true" /><span>Error capture is off. New errors are not being recorded.</span></div>}
      <div className="analytics-error-summary" aria-label="Error statistics">
        <Tile label="Total errors" value={metric(summary?.total)} tone="blue" />
        <Tile label="Unexpected (5xx)" value={metric(summary?.unexpected)} tone="peach" />
        {summary?.clientErrorsCaptured && <Tile label="Client (4xx)" value={metric(summary.expected)} tone="violet" />}
        <Tile label="Oldest retained" value={metric(summary ? summary.oldestRecorded ? ago(summary.oldestRecorded) : 'No records' : undefined)} tone="green" />
      </div>
      <div className="analytics-error-filters">
        <div className="analytics-search"><Search size={18} aria-hidden="true" /><input ref={searchRef} type="search" className="input-control" aria-label="Filter errors by message or path" autoCapitalize="none" spellCheck={false}
          placeholder="Search errors…" value={search} onChange={(event) => setSearch(event.target.value)} />
          {search && <button onClick={() => { setSearch(''); searchRef.current?.focus({ preventScroll: true }); }} aria-label="Clear error search"><X size={17} /></button>}
        </div>
        <Dropdown aria-label="Filter errors by severity" value={severity} onChange={(event) => { setSeverity(event.target.value); setPage(1); }}>
          <option value="">All severities</option><option value="UNEXPECTED">Unexpected (5xx)</option><option value="EXPECTED">Client (4xx)</option>
        </Dropdown>
      </div>
      {error && <AnalyticsError message={(error as Error).message || 'Error logs are unavailable.'} retry={() => refetch()} />}
      <div className="analytics-log-panel" aria-busy={isFetching}>
        {isLoading ? <LoadingState label="Loading error logs…" /> : !rows.length ? <div className="analytics-empty"><ShieldAlert size={28} aria-hidden="true" /><h4>{error ? 'Error logs unavailable' : 'No matching errors'}</h4><p>{error ? 'Try loading the error log again.' : 'No errors match these filters in the current recording window.'}</p></div> : (
          <table className="analytics-table analytics-error-table" role="table" aria-label="Application error log">
            <thead><tr><th>When</th><th>Severity</th><th>Status</th><th>Endpoint</th><th>Message</th><th>Context</th></tr></thead>
            <tbody>{rows.map((row) => {
              const isOpen = expanded === row.id;
              const contextId = `analytics-error-context-${row.id}`;
              return <React.Fragment key={row.id}>
                <tr className={`analytics-error-row${isOpen ? ' is-open' : ''}`}>
                  <td className="error-cell-date"><time dateTime={row.occurredAt} title={new Date(row.occurredAt).toLocaleString()}>{ago(row.occurredAt)}</time></td>
                  <td className="error-cell-severity"><span className={`analytics-pill ${row.severity === 'UNEXPECTED' ? 'tone-danger' : 'tone-warning'}`}>{row.severity === 'UNEXPECTED' ? <ShieldAlert size={12} aria-hidden="true" /> : <AlertTriangle size={12} aria-hidden="true" />}{row.severity === 'UNEXPECTED' ? 'Unexpected' : 'Client'}</span></td>
                  <td className="error-cell-status">{row.statusCode}</td>
                  <td className="error-cell-endpoint"><div><span className="analytics-method">{row.method}</span><code>{row.route}</code></div>{row.route !== row.path && <small>{row.path}</small>}</td>
                  <td className="error-cell-message">{row.message}</td>
                  <td className="error-cell-action"><button className="analytics-context-button" aria-label={`${isOpen ? 'Hide' : 'Show'} error context for ${row.method} ${row.route}`} aria-expanded={isOpen} aria-controls={contextId} onClick={() => setExpanded(isOpen ? null : row.id)}><span>Details</span><ChevronDown size={17} aria-hidden="true" /></button></td>
                </tr>
                {isOpen && <tr className="analytics-error-context-row"><td colSpan={6}><div id={contextId} className="analytics-error-context">
                  <dl><Detail label="Occurred" value={new Date(row.occurredAt).toLocaleString()} /><Detail label="Error" value={row.name} /><Detail label="Request ID" value={row.requestId} /><Detail label="User" value={row.userId} /><Detail label="Admin" value={row.adminId} /><Detail label="IP" value={row.ip} /><Detail label="User agent" value={row.userAgent} /></dl>
                  {row.stack && <div className="analytics-stack"><span>Stack · application frames</span><pre tabIndex={0} aria-label="Application stack trace">{row.stack}</pre></div>}
                </div></td></tr>}
              </React.Fragment>;
            })}</tbody>
          </table>
        )}
        <Pagination page={page} totalPages={data?.pagination.pages} total={data?.pagination.total} onChange={setPage} label="errors" busy={isFetching} />
      </div>
      {data?.topRoutes && data.topRoutes.length > 0 && <section className="analytics-top-routes" aria-label="Most frequent error routes"><div className="analytics-section-heading"><h4>Most frequent errors</h4></div>
        <ol>{data.topRoutes.map((route) => <li key={route.route}><code>{route.route}</code><div className="analytics-route-numbers"><span><strong>{route.count.toLocaleString()}×</strong> recorded</span><span>Last seen <strong>{ago(route.lastSeen)}</strong></span></div></li>)}</ol>
      </section>}
    </section>
  );
};

const Tile: React.FC<{ label: string; value: string; tone: string }> = ({ label, value, tone }) => (
  <dl className={`analytics-stat tone-${tone}`}><dt>{label}</dt><dd>{value}</dd></dl>
);
const Detail: React.FC<{ label: string; value: string | null }> = ({ label, value }) => value ? <div><dt>{label}</dt><dd>{value}</dd></div> : null;

export default ErrorLogsPanel;
