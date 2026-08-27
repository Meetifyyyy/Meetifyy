import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Bug, Loader2, ScrollText, Search, X } from 'lucide-react';

import { formatDateTime, monitoringApi, statusBadgeClass } from './monitoringApi';

type Mode = 'requests' | 'errors';

/**
 * Filterable, paginated request and error logs.
 *
 * Two views over the same incident rather than two features: the request table
 * answers "what happened", the error table answers "what did it say". They
 * share a route filter so clicking through from the endpoints table narrows
 * both.
 *
 * Filtering and pagination are server-side - the table can cover millions of
 * rows and only the server can page across them coherently.
 */
export const RequestLogTable: React.FC<{
  pollMs: number;
  routeFilter: string;
  onRouteFilterChange: (route: string) => void;
}> = ({ pollMs, routeFilter, onRouteFilterChange }) => {
  const [mode, setMode] = useState<Mode>('requests');
  const [routeInput, setRouteInput] = useState(routeFilter);
  const [method, setMethod] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  // The endpoints table drives this from outside, so the input follows it.
  useEffect(() => {
    setRouteInput(routeFilter);
    setPage(1);
  }, [routeFilter]);

  // Debounced so typing a route does not fire a query per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (routeInput !== routeFilter) {
        onRouteFilterChange(routeInput);
        setPage(1);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [routeInput, routeFilter, onRouteFilterChange]);

  const requests = useQuery({
    queryKey: ['monitoringLogs', { routeFilter, method, status, page }],
    queryFn: () => monitoringApi.getLogs({ route: routeFilter, method, status, page }),
    enabled: mode === 'requests',
    refetchInterval: pollMs,
    placeholderData: (previous) => previous,
  });

  const errors = useQuery({
    queryKey: ['monitoringErrors', { routeFilter, page }],
    queryFn: () => monitoringApi.getErrors({ route: routeFilter, page }),
    enabled: mode === 'errors',
    refetchInterval: pollMs,
    placeholderData: (previous) => previous,
  });

  const active = mode === 'requests' ? requests : errors;
  const meta = active.data?.meta;

  const retentionHours = (active.data?.meta as any)?.retentionHours ?? 48;

  return (
    <section id="monitoring-logs" className="glass-panel" style={{ overflow: 'hidden' }}>
      <div style={head}>
        <div style={tabs} role="tablist" aria-label="Log view">
          <TabButton active={mode === 'requests'} onClick={() => { setMode('requests'); setPage(1); }} icon={<ScrollText size={13} />}>
            Requests
          </TabButton>
          <TabButton active={mode === 'errors'} onClick={() => { setMode('errors'); setPage(1); }} icon={<Bug size={13} />}>
            Errors
          </TabButton>
        </div>
        <span style={retentionBadge}>Last {retentionHours}h</span>
        {active.isFetching && <Loader2 size={12} className="spin" style={{ color: 'var(--color-text-dim)', marginLeft: 'auto' }} />}
      </div>

      <div style={filterBar}>
        <div style={{ position: 'relative', flex: '1 1 14rem', minWidth: '10rem' }}>
          <Search size={13} style={searchIcon} />
          <input
            className="input-control"
            style={{ paddingLeft: '1.9rem', fontSize: '0.76rem', width: '100%' }}
            placeholder="Filter by route"
            value={routeInput}
            onChange={(e) => setRouteInput(e.target.value)}
            aria-label="Filter by route"
          />
          {routeInput && (
            <button type="button" style={clearBtn} onClick={() => setRouteInput('')} aria-label="Clear route filter">
              <X size={12} />
            </button>
          )}
        </div>

        {mode === 'requests' && (
          <>
            <select
              className="input-control"
              style={selectStyle}
              value={method}
              onChange={(e) => { setMethod(e.target.value); setPage(1); }}
              aria-label="Filter by method"
            >
              <option value="">Any method</option>
              {['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>

            <select
              className="input-control"
              style={selectStyle}
              value={status}
              onChange={(e) => { setStatus(e.target.value); setPage(1); }}
              aria-label="Filter by status"
            >
              <option value="">Any status</option>
              {/* A status class is what an admin actually wants; the server
                  widens a bare digit into the range. */}
              <option value="2">2xx success</option>
              <option value="3">3xx redirect</option>
              <option value="4">4xx client error</option>
              <option value="5">5xx server error</option>
            </select>
          </>
        )}
      </div>

      {mode === 'errors' && errors.data && !errors.data.stackTracesEnabled && (
        <div style={hintBar}>
          <AlertTriangle size={12} />
          <span>Stack traces are disabled (LOG_STACK_TRACES). Only sanitized messages are stored.</span>
        </div>
      )}

      {active.isLoading ? (
        <div style={empty}>
          <Loader2 size={16} className="spin" />
          <span>Loading</span>
        </div>
      ) : active.isError ? (
        <div style={empty}>
          <AlertTriangle size={16} color="var(--color-danger)" />
          <span>{(active.error as any)?.message || 'Could not load logs.'}</span>
        </div>
      ) : (active.data?.data ?? []).length === 0 ? (
        <div style={empty}>
          <span>Nothing recorded for these filters.</span>
        </div>
      ) : mode === 'requests' ? (
        <div className="table-responsive">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Method</th>
                <th>Route</th>
                <th style={{ textAlign: 'right' }}>Status</th>
                <th style={{ textAlign: 'right' }}>Duration</th>
                <th>Request ID</th>
              </tr>
            </thead>
            <tbody>
              {requests.data.data.map((row: any) => (
                <tr key={row.id}>
                  <td style={dim}>{formatDateTime(row.createdAt)}</td>
                  <td style={dim}>{row.method}</td>
                  <td style={mono}>{row.route}</td>
                  <td style={{ textAlign: 'right' }}>
                    <span className={`badge ${statusBadgeClass(row.statusCode)}`}>{row.statusCode}</span>
                  </td>
                  <td style={{ ...numeric, color: row.durationMs > 1000 ? 'var(--color-danger)' : undefined }}>
                    {row.durationMs} ms
                  </td>
                  <td style={{ ...mono, color: 'var(--color-text-light)' }}>{row.requestId ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="table-responsive">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Route</th>
                <th style={{ textAlign: 'right' }}>Status</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {errors.data.data.map((row: any) => (
                <tr key={row.id}>
                  <td style={dim}>{formatDateTime(row.createdAt)}</td>
                  <td style={mono}>{row.route}</td>
                  <td style={{ textAlign: 'right' }}>
                    {row.statusCode ? (
                      <span className={`badge ${statusBadgeClass(row.statusCode)}`}>{row.statusCode}</span>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td style={{ fontSize: '0.76rem', wordBreak: 'break-word' }}>
                    {row.message}
                    {row.stack && (
                      <details style={{ marginTop: '0.3rem' }}>
                        <summary style={{ fontSize: '0.7rem', color: 'var(--color-text-light)', cursor: 'pointer' }}>
                          Stack trace
                        </summary>
                        <pre style={stackStyle}>{row.stack}</pre>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {meta && meta.totalPages > 1 && (
        <div style={pager}>
          <button
            className="btn-secondary"
            style={pagerBtn}
            disabled={meta.page <= 1 || active.isFetching}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </button>
          <span style={{ fontSize: '0.72rem', color: 'var(--color-text-light)' }}>
            Page {meta.page} of {meta.totalPages} · {meta.total.toLocaleString()} rows · last {retentionHours}h
          </span>
          <button
            className="btn-secondary"
            style={pagerBtn}
            disabled={meta.page >= meta.totalPages || active.isFetching}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      )}
    </section>
  );
};

const TabButton: React.FC<{ active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }> = ({
  active,
  onClick,
  icon,
  children,
}) => (
  <button
    type="button"
    role="tab"
    aria-selected={active}
    onClick={onClick}
    style={{
      ...tabButton,
      color: active ? 'var(--color-primary)' : 'var(--color-text-light)',
      borderBottomColor: active ? 'var(--color-primary)' : 'transparent',
      fontWeight: active ? 700 : 500,
    }}
  >
    {icon}
    <span>{children}</span>
  </button>
);

// ── Styles ─────────────────────────────────────────────────────────────────

const retentionBadge: React.CSSProperties = {
  fontSize: '0.66rem',
  fontWeight: 600,
  color: 'var(--color-text-light)',
  background: 'var(--color-bg-soft)',
  border: '1px solid var(--color-border)',
  borderRadius: '4px',
  padding: '1px 6px',
  marginLeft: '0.25rem',
  whiteSpace: 'nowrap',
};

const head: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  padding: '0 1rem',
  borderBottom: '1px solid var(--color-border)',
  background: 'var(--color-bg-alt)',
};

const tabs: React.CSSProperties = { display: 'flex', gap: '0.15rem' };

const tabButton: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.3rem',
  padding: '0.55rem 0.6rem',
  fontFamily: 'inherit',
  fontSize: '0.78rem',
  background: 'none',
  border: 'none',
  borderBottom: '2px solid transparent',
  marginBottom: '-1px',
  cursor: 'pointer',
};

const filterBar: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.4rem',
  padding: '0.6rem 1rem',
  borderBottom: '1px solid var(--color-border)',
};

const selectStyle: React.CSSProperties = { padding: '0.28rem 0.4rem', fontSize: '0.74rem', flex: '0 1 9rem' };

const searchIcon: React.CSSProperties = {
  position: 'absolute',
  left: '0.55rem',
  top: '50%',
  transform: 'translateY(-50%)',
  color: 'var(--color-text-dim)',
  pointerEvents: 'none',
};

const clearBtn: React.CSSProperties = {
  position: 'absolute',
  right: '0.45rem',
  top: '50%',
  transform: 'translateY(-50%)',
  display: 'inline-flex',
  border: 'none',
  background: 'none',
  color: 'var(--color-text-dim)',
  cursor: 'pointer',
  padding: 0,
};

const hintBar: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.35rem',
  padding: '0.4rem 1rem',
  fontSize: '0.72rem',
  color: 'var(--color-text-light)',
  background: 'var(--color-bg-soft)',
  borderBottom: '1px solid var(--color-border)',
};

const empty: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.5rem',
  padding: '2.5rem',
  color: 'var(--color-text-dim)',
  fontSize: '0.8rem',
};

const mono: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '0.74rem',
};

const dim: React.CSSProperties = { fontSize: '0.73rem', color: 'var(--color-text-light)', whiteSpace: 'nowrap' };

const numeric: React.CSSProperties = { textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: '0.75rem' };

const stackStyle: React.CSSProperties = {
  margin: '0.3rem 0 0',
  padding: '0.5rem',
  fontSize: '0.68rem',
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  background: 'var(--color-bg-soft)',
  borderRadius: 'var(--radius-sm)',
  maxHeight: '14rem',
  overflow: 'auto',
};

const pager: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.5rem',
  padding: '0.5rem 1rem',
  borderTop: '1px solid var(--color-border)',
  background: 'var(--color-bg-alt)',
};

const pagerBtn: React.CSSProperties = { padding: '0.22rem 0.6rem', fontSize: '0.72rem' };
