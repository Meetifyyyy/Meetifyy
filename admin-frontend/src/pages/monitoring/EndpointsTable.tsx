import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Loader2, Search } from 'lucide-react';

import { monitoringApi, type TimeWindow } from './monitoringApi';

type SortKey = 'route' | 'requests' | 'avgMs' | 'p95Ms' | 'errorRatePercent';

/**
 * Per-endpoint breakdown, worst first.
 *
 * Sorted client-side because the server already caps this at the 50 slowest
 * routes: re-querying to reorder fifty rows would be a round trip for work the
 * browser does instantly. The full-table aggregation stays on the server,
 * where the row count actually justifies it.
 */
export const EndpointsTable: React.FC<{
  window: TimeWindow;
  pollMs: number;
  onInspectRoute: (route: string) => void;
}> = ({ window, pollMs, onInspectRoute }) => {
  const [sortKey, setSortKey] = useState<SortKey>('p95Ms');
  const [ascending, setAscending] = useState(false);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['monitoringEndpoints', window],
    queryFn: () => monitoringApi.getEndpoints(window),
    refetchInterval: pollMs,
  });

  const source = data?.source ?? 'raw';
  const subtitleText =
    source === 'slow_requests_7d'
      ? 'Slowest routes · 7-day slow-request records · Select a row to trace recent requests.'
      : 'Slowest first · Raw request logs · Select a row to trace recent requests.';

  const rows = useMemo(() => {
    const list = [...(data?.endpoints ?? [])];
    list.sort((a: any, b: any) => {
      const left = a[sortKey];
      const right = b[sortKey];
      if (typeof left === 'string' || typeof right === 'string') {
        return ascending ? String(left).localeCompare(String(right)) : String(right).localeCompare(String(left));
      }
      return ascending ? left - right : right - left;
    });
    return list;
  }, [data, sortKey, ascending]);

  const toggle = (key: SortKey) => {
    if (key === sortKey) setAscending((v) => !v);
    else {
      setSortKey(key);
      // Numeric columns are most useful worst-first; the route name is not.
      setAscending(key === 'route');
    }
  };

  const header = (key: SortKey, label: string, align: 'left' | 'right' = 'right') => (
    <th style={{ textAlign: align, cursor: 'pointer', whiteSpace: 'nowrap' }} onClick={() => toggle(key)}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
        {label}
        {sortKey === key && (ascending ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
      </span>
    </th>
  );

  return (
    <section className="glass-panel" style={{ overflow: 'hidden', marginBottom: '0.85rem' }}>
      <div style={head}>
        <h3 style={title}>Endpoints</h3>
        <span style={subtitle}>{subtitleText}</span>
        {isFetching && <Loader2 size={12} className="spin" style={{ color: 'var(--color-text-dim)' }} />}
      </div>

      {isLoading ? (
        <div style={empty}>
          <Loader2 size={16} className="spin" />
          <span>Loading endpoints</span>
        </div>
      ) : rows.length === 0 ? (
        <div style={empty}>
          <span>No requests recorded in this window.</span>
        </div>
      ) : (
        <div className="table-responsive">
          <table className="admin-table">
            <thead>
              <tr>
                {header('route', 'Route', 'left')}
                <th style={{ textAlign: 'left' }}>Method</th>
                {header('requests', 'Requests')}
                {header('avgMs', 'Avg')}
                {header('p95Ms', 'p95')}
                {header('errorRatePercent', 'Errors')}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row: any) => (
                <tr key={`${row.method}-${row.route}`}>
                  <td style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.75rem' }}>
                    {row.route}
                  </td>
                  <td style={{ fontSize: '0.72rem', color: 'var(--color-text-light)' }}>{row.method}</td>
                  <td style={numeric}>{row.requests.toLocaleString()}</td>
                  <td style={numeric}>{Math.round(row.avgMs)} ms</td>
                  <td
                    style={{
                      ...numeric,
                      // The tail is the number that decides whether an endpoint
                      // is actually a problem, so it is the one that colours.
                      color: row.p95Ms > 1000 ? 'var(--color-danger)' : 'var(--color-text-main)',
                      fontWeight: row.p95Ms > 1000 ? 700 : 400,
                    }}
                  >
                    {Math.round(row.p95Ms)} ms
                  </td>
                  <td style={{ ...numeric, color: row.errorRatePercent > 5 ? 'var(--color-danger)' : undefined }}>
                    {row.errorRatePercent.toFixed(1)}%
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      className="btn-secondary"
                      style={{ padding: '0.18rem 0.45rem', fontSize: '0.68rem' }}
                      onClick={() => onInspectRoute(row.route)}
                      title="Show recent requests for this route"
                    >
                      <Search size={11} />
                      <span>Traces</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

const head: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: '0.5rem',
  flexWrap: 'wrap',
  padding: '0.75rem 1rem',
  borderBottom: '1px solid var(--color-border)',
  background: 'var(--color-bg-alt)',
};

const title: React.CSSProperties = { margin: 0, fontSize: '0.85rem', fontWeight: 700 };
const subtitle: React.CSSProperties = { fontSize: '0.72rem', color: 'var(--color-text-light)' };
const numeric: React.CSSProperties = { textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: '0.76rem' };

const empty: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.5rem',
  padding: '2rem',
  color: 'var(--color-text-dim)',
  fontSize: '0.8rem',
};
