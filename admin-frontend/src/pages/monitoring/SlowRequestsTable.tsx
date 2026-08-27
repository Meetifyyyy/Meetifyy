import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Clock, Loader2, Zap } from 'lucide-react';

import { formatDateTime, monitoringApi, statusBadgeClass } from './monitoringApi';

type SortKey = 'durationMs' | 'route' | 'occurredAt' | 'statusCode';

/**
 * Slow requests from the rolling 7-day SlowRequest materialized table.
 *
 * Unlike the raw RequestLog (which is pruned after 48 hours), this table is
 * populated continuously by MetricsAggregatorService and retains the
 * worst-latency requests for the full configured window. No expensive scan
 * of millions of raw rows is needed — the materialized table holds only the
 * rows that actually exceeded the slow-request threshold.
 */
export const SlowRequestsTable: React.FC<{
  pollMs: number;
  onInspectRoute: (route: string) => void;
}> = ({ pollMs, onInspectRoute }) => {
  const [sortKey, setSortKey] = useState<SortKey>('durationMs');
  const [ascending, setAscending] = useState(false);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['monitoringSlowRequests'],
    queryFn: () => monitoringApi.getSlowRequests(),
    refetchInterval: pollMs,
  });

  const rows = useMemo(() => {
    const list = [...(data?.rows ?? [])];
    list.sort((a: any, b: any) => {
      const left = a[sortKey];
      const right = b[sortKey];
      if (sortKey === 'route') {
        return ascending
          ? String(left).localeCompare(String(right))
          : String(right).localeCompare(String(left));
      }
      if (sortKey === 'occurredAt') {
        const la = new Date(left).getTime();
        const ra = new Date(right).getTime();
        return ascending ? la - ra : ra - la;
      }
      return ascending ? Number(left) - Number(right) : Number(right) - Number(left);
    });
    return list;
  }, [data, sortKey, ascending]);

  const toggle = (key: SortKey) => {
    if (key === sortKey) setAscending((v) => !v);
    else {
      setSortKey(key);
      setAscending(key === 'route');
    }
  };

  const sortIcon = (key: SortKey) =>
    sortKey === key ? (ascending ? <ArrowUp size={10} /> : <ArrowDown size={10} />) : null;

  const thresholdMs = data?.thresholdMs ?? 800;
  const retentionDays = data?.retentionDays ?? 7;

  return (
    <section className="glass-panel" style={{ overflow: 'hidden', marginBottom: '0.85rem' }}>
      <div style={head}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <Zap size={14} style={{ color: 'var(--color-warning, #b45309)' }} />
          <h3 style={title}>Slow Requests</h3>
        </div>
        <span style={subtitle}>
          Requests ≥ {thresholdMs} ms · Rolling {retentionDays} days
        </span>
        {isFetching && <Loader2 size={12} className="spin" style={{ color: 'var(--color-text-dim)', marginLeft: 'auto' }} />}
      </div>

      {isLoading ? (
        <div style={empty}>
          <Loader2 size={16} className="spin" />
          <span>Loading slow requests</span>
        </div>
      ) : rows.length === 0 ? (
        <div style={empty}>
          <Clock size={16} style={{ color: 'var(--color-success)' }} />
          <span>No requests exceeded {thresholdMs} ms in the last {retentionDays} days.</span>
        </div>
      ) : (
        <div className="table-responsive">
          <table className="admin-table">
            <thead>
              <tr>
                <th
                  style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}
                  onClick={() => toggle('occurredAt')}
                >
                  <span style={thContent}>Time {sortIcon('occurredAt')}</span>
                </th>
                <th
                  style={{ textAlign: 'left', cursor: 'pointer', whiteSpace: 'nowrap' }}
                  onClick={() => toggle('route')}
                >
                  <span style={thContent}>Route {sortIcon('route')}</span>
                </th>
                <th style={{ textAlign: 'left' }}>Method</th>
                <th
                  style={{ textAlign: 'right', cursor: 'pointer', whiteSpace: 'nowrap' }}
                  onClick={() => toggle('statusCode')}
                >
                  <span style={thContent}>Status {sortIcon('statusCode')}</span>
                </th>
                <th
                  style={{ textAlign: 'right', cursor: 'pointer', whiteSpace: 'nowrap' }}
                  onClick={() => toggle('durationMs')}
                >
                  <span style={thContent}>Duration {sortIcon('durationMs')}</span>
                </th>
                <th style={{ textAlign: 'left' }}>Request ID</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row: any) => (
                <tr key={row.id}>
                  <td style={dim}>{formatDateTime(row.occurredAt)}</td>
                  <td style={mono}>{row.route}</td>
                  <td style={{ fontSize: '0.72rem', color: 'var(--color-text-light)' }}>{row.method}</td>
                  <td style={{ textAlign: 'right' }}>
                    <span className={`badge ${statusBadgeClass(row.statusCode)}`}>{row.statusCode}</span>
                  </td>
                  <td
                    style={{
                      textAlign: 'right',
                      fontVariantNumeric: 'tabular-nums',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      color:
                        row.durationMs >= 3000
                          ? 'var(--color-danger)'
                          : row.durationMs >= 1500
                          ? 'var(--color-warning, #b45309)'
                          : 'var(--color-text-main)',
                    }}
                  >
                    {row.durationMs >= 1000
                      ? `${(row.durationMs / 1000).toFixed(2)} s`
                      : `${row.durationMs} ms`}
                  </td>
                  <td style={{ ...mono, color: 'var(--color-text-light)', maxWidth: '9rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {row.requestId ?? '-'}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      className="btn-secondary"
                      style={{ padding: '0.18rem 0.45rem', fontSize: '0.68rem' }}
                      onClick={() => onInspectRoute(row.route)}
                      title={`Filter recent logs for ${row.route}`}
                    >
                      Traces
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

// ── Styles ──────────────────────────────────────────────────────────────────

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

const thContent: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.2rem',
};

const empty: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.5rem',
  padding: '2rem',
  color: 'var(--color-text-dim)',
  fontSize: '0.8rem',
};

const mono: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '0.74rem',
};

const dim: React.CSSProperties = {
  fontSize: '0.73rem',
  color: 'var(--color-text-light)',
  whiteSpace: 'nowrap',
};
