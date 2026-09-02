import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ShieldAlert } from '../../components/icons';
import { Pagination } from '../../components/Pagination';
import { analyticsApi, type ErrorLogRow } from './analyticsApi';

/**
 * Application errors from the retention window.
 *
 * The rows are written by HttpExceptionFilter, which is the only place that has
 * the exception, the request and the resolved status together. Nothing here is
 * re-derived in the browser: this is a view over what actually failed.
 *
 * Kept as its own panel rather than folded into AnalyticsPage because the page
 * is already long, and because a section that only matters during an incident
 * should be reachable without reading past the parts that do not.
 */

const SEVERITY_STYLE: Record<string, { tone: string; tint: string; label: string }> = {
  UNEXPECTED: { tone: 'var(--color-danger)', tint: 'var(--color-danger-tint)', label: 'Unexpected' },
  EXPECTED: { tone: 'var(--color-warning)', tint: 'var(--color-warning-tint)', label: 'Client' },
};

/** "3m ago" / "4h ago" / "2d ago" - the useful precision for a 7-day window. */
function ago(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export const ErrorLogsPanel: React.FC = () => {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [severity, setSeverity] = useState<string>('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['adminErrorLogs', page, search, severity],
    queryFn: () => analyticsApi.getErrorLogs({ page, search: search || undefined, severity: severity || undefined }),
    // Errors are the one thing you want current while watching an incident.
    refetchInterval: 30_000,
  });

  const rows: ErrorLogRow[] = data?.rows ?? [];
  const summary = data?.summary;

  return (
    <div style={{ marginTop: '1.25rem' }}>
      <div style={{ marginBottom: '0.75rem' }}>
        <h3 style={{ margin: '0 0 0.15rem', fontSize: '0.92rem', fontWeight: 700 }}>Error Logs</h3>
        <p style={{ margin: 0, fontSize: '0.74rem', color: 'var(--color-text-dim)' }}>
          {summary
            ? `Application errors from the last ${summary.retentionDays} days. Older rows are deleted automatically.`
            : 'Application errors recorded by the server.'}
        </p>
      </div>

      {summary && !summary.captureEnabled && (
        <div
          className="glass-panel"
          style={{
            padding: '0.5rem 0.75rem', marginBottom: '0.75rem',
            background: 'var(--color-warning-tint)', color: 'var(--color-warning)',
            fontSize: '0.74rem', display: 'flex', gap: '0.4rem', alignItems: 'center',
          }}
        >
          <AlertTriangle size={13} />
          Error capture is switched off, so this list is not being added to.
        </div>
      )}

      {summary && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', marginBottom: '0.75rem' }}>
          <Tile label="Total" value={summary.total} />
          <Tile label="Unexpected (5xx)" value={summary.unexpected} tone="var(--color-danger)" />
          {summary.clientErrorsCaptured && <Tile label="Client (4xx)" value={summary.expected} />}
          <Tile
            label="Oldest kept"
            /* The window is 7 days; what is actually held is often less, and
               saying "7 days" over two days of data invites the wrong reading
               of a low count. */
            value={summary.oldestRecorded ? ago(summary.oldestRecorded) : 'nothing yet'}
          />
        </div>
      )}

      <div className="glass-panel admin-filter-bar" style={{ padding: '0.5rem 0.75rem', marginBottom: '0.75rem', display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Filter by message or path..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="input-control"
          style={{ flex: '1 1 200px' }}
        />
        <select
          value={severity}
          onChange={(e) => { setSeverity(e.target.value); setPage(1); }}
          className="input-control"
          style={{ flex: '0 1 150px' }}
        >
          <option value="">All severities</option>
          <option value="UNEXPECTED">Unexpected (5xx)</option>
          <option value="EXPECTED">Client (4xx)</option>
        </select>
      </div>

      <div className="glass-panel" style={{ overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-text-dim)', fontSize: '0.85rem' }}>
            Loading error logs...
          </div>
        ) : rows.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-text-dim)', fontSize: '0.85rem' }}>
            No errors recorded in this window.
          </div>
        ) : (
          <div className="table-responsive">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Severity</th>
                  <th>Status</th>
                  <th>Endpoint</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const style = SEVERITY_STYLE[row.severity] ?? SEVERITY_STYLE.EXPECTED;
                  const isOpen = expanded === row.id;
                  return (
                    <React.Fragment key={row.id}>
                      <tr
                        onClick={() => setExpanded(isOpen ? null : row.id)}
                        style={{ cursor: 'pointer' }}
                        title="Show context"
                      >
                        <td style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                          <span title={new Date(row.occurredAt).toLocaleString()}>{ago(row.occurredAt)}</span>
                        </td>
                        <td>
                          <span
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                              padding: '2px 8px', borderRadius: 999,
                              background: style.tint, color: style.tone,
                              fontSize: '0.7rem', fontWeight: 700, whiteSpace: 'nowrap',
                            }}
                          >
                            {row.severity === 'UNEXPECTED' ? <ShieldAlert size={11} /> : <AlertTriangle size={11} />}
                            {style.label}
                          </span>
                        </td>
                        <td style={{ fontVariantNumeric: 'tabular-nums' }}>{row.statusCode}</td>
                        <td style={{ maxWidth: 260 }}>
                          <div style={{ fontSize: '0.78rem', fontWeight: 600 }}>{row.method} {row.route}</div>
                          {row.route !== row.path && (
                            <div style={{ fontSize: '0.72rem', color: 'var(--color-text-dim)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {row.path}
                            </div>
                          )}
                        </td>
                        <td style={{ maxWidth: 360, fontSize: '0.8rem' }}>{row.message}</td>
                      </tr>

                      {isOpen && (
                        <tr>
                          <td colSpan={5} style={{ background: 'var(--color-bg-alt)' }}>
                            <div style={{ display: 'grid', gap: '0.5rem', padding: '0.5rem 0.25rem', fontSize: '0.78rem' }}>
                              <Detail label="Occurred" value={new Date(row.occurredAt).toLocaleString()} />
                              <Detail label="Error" value={row.name} />
                              <Detail label="Request id" value={row.requestId} />
                              <Detail label="User" value={row.userId} />
                              <Detail label="Admin" value={row.adminId} />
                              <Detail label="IP" value={row.ip} />
                              <Detail label="User agent" value={row.userAgent} />
                              {row.stack && (
                                <div>
                                  <div style={{ color: 'var(--color-text-dim)', marginBottom: 4 }}>Stack (application frames)</div>
                                  <pre
                                    style={{
                                      margin: 0, padding: '0.6rem 0.75rem', borderRadius: 8,
                                      background: 'var(--color-bg-dark)', color: '#e2e8f0',
                                      fontSize: '0.72rem', lineHeight: 1.5,
                                      overflowX: 'auto', whiteSpace: 'pre',
                                    }}
                                  >
                                    {row.stack}
                                  </pre>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Pagination
        page={data?.pagination?.page ?? 1}
        totalPages={data?.pagination?.pages ?? 1}
        total={data?.pagination?.total}
        onChange={setPage}
        label="errors"
        busy={isFetching}
      />

      {data?.topRoutes && data.topRoutes.length > 0 && (
        <div className="glass-panel" style={{ padding: '1rem', marginTop: '1rem' }}>
          <h4 style={{ margin: '0 0 0.6rem', fontSize: '0.85rem', fontWeight: 700 }}>
            Most frequent
          </h4>
          {/* The list alone cannot say whether this is one fault repeating or
              many different ones. This can. */}
          <div style={{ display: 'grid', gap: '0.4rem' }}>
            {data.topRoutes.map((r) => (
              <div key={r.route} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', fontSize: '0.78rem' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.route}</span>
                <span style={{ color: 'var(--color-text-dim)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                  {r.count}× · last {ago(r.lastSeen)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const Tile: React.FC<{ label: string; value: number | string; tone?: string }> = ({ label, value, tone }) => (
  <div className="glass-panel" style={{ padding: '0.45rem 0.65rem', minWidth: 100, flex: '1 1 100px' }}>
    <div style={{ fontSize: '0.62rem', color: 'var(--color-text-dim)', marginBottom: 2 }}>{label}</div>
    <div style={{ fontSize: '0.95rem', fontWeight: 700, color: tone, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
  </div>
);

const Detail: React.FC<{ label: string; value: string | null }> = ({ label, value }) =>
  value ? (
    <div style={{ display: 'flex', gap: '0.5rem' }}>
      <span style={{ color: 'var(--color-text-dim)', minWidth: 96 }}>{label}</span>
      <span style={{ wordBreak: 'break-all' }}>{value}</span>
    </div>
  ) : null;

export default ErrorLogsPanel;
