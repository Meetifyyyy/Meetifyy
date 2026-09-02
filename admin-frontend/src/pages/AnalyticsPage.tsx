import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, RefreshCw, Server, Timer, AlertCircle, ShieldCheck, Globe } from '../components/icons';
import {
  analyticsApi,
  formatBytes,
  formatMetric,
  usageRatio,
  type ServiceMetric,
  type ServiceReport,
  type ServiceState,
  type SlowRequestRow,
  type SlowRequestSurface,
} from './analytics/analyticsApi';
import { Pagination } from '../components/Pagination';
import { useDebounced } from '../hooks/useDebounced';
import { ErrorLogsPanel } from './analytics/ErrorLogsPanel';

/**
 * Infrastructure and resource usage.
 *
 * Three things are kept visually distinct because they mean different things:
 * current usage, the ceiling it is measured against (only shown where the
 * provider actually publishes one), and whether the service answered at all.
 * A service with no credentials is never drawn as healthy-with-zero-usage.
 */

const STATE_BADGE: Record<ServiceState, { cls: string; label: string }> = {
  UP: { cls: 'badge badge-success', label: 'Operational' },
  DOWN: { cls: 'badge badge-danger', label: 'Unavailable' },
  NOT_CONFIGURED: { cls: 'badge badge-neutral', label: 'Not configured' },
};

const METHOD_COLOR: Record<string, string> = {
  GET: 'var(--color-primary)',
  POST: 'var(--color-success)',
  PATCH: 'var(--color-warning)',
  PUT: 'var(--color-warning)',
  DELETE: 'var(--color-danger)',
};

/** A single measurement, with its ceiling drawn underneath when there is one. */
const MetricRow: React.FC<{ metric: ServiceMetric }> = ({
  metric,
}) => {
  const ratio = usageRatio(metric);
  const nearLimit = ratio !== null && ratio >= 0.8;

  return (
    <div style={{ marginBottom: '0.6rem' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: '0.5rem',
        }}
      >
        <span style={{ fontSize: '0.78rem', color: 'var(--color-text-light)' }}>
          {metric.label}
        </span>
        <span
          style={{
            fontSize: '0.85rem',
            fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
            color: nearLimit ? 'var(--color-danger)' : 'var(--color-text-main)',
          }}
        >
          {formatMetric(metric)}
          {metric.limit ? (
            <span
              style={{
                fontWeight: 500,
                color: 'var(--color-text-dim)',
                fontSize: '0.78rem',
              }}
            >
              {' / '}
              {metric.unit === 'bytes'
                ? formatBytes(metric.limit)
                : metric.limit.toLocaleString()}
            </span>
          ) : null}
        </span>
      </div>

      {ratio !== null && (
        <div
          style={{
            height: '4px',
            background: 'var(--color-bg-soft)',
            borderRadius: '2px',
            marginTop: '0.3rem',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${Math.max(2, ratio * 100)}%`,
              height: '100%',
              background: nearLimit
                ? 'var(--color-danger)'
                : 'var(--color-primary)',
            }}
          />
        </div>
      )}
    </div>
  );
};

const ServiceCard: React.FC<{ service: ServiceReport }> = ({ service }) => {
  const badge = STATE_BADGE[service.state];

  return (
    <div className="glass-panel" style={{ padding: '1.1rem 1.25rem' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
          marginBottom: '0.35rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
          <Server size={15} color="var(--color-primary)" />
          <h3
            style={{
              fontSize: '0.92rem',
              fontWeight: 700,
              color: 'var(--color-text-main)',
            }}
          >
            {service.name}
          </h3>
        </div>
        <span className={badge.cls} style={{ fontSize: '0.65rem' }}>
          {badge.label}
        </span>
      </div>

      {service.detail && (
        <p
          style={{
            fontSize: '0.76rem',
            color:
              service.state === 'DOWN'
                ? 'var(--color-danger-hover)'
                : 'var(--color-text-dim)',
            marginBottom: '0.75rem',
            wordBreak: 'break-word',
          }}
        >
          {service.detail}
        </p>
      )}

      {service.metrics && service.metrics.length > 0 ? (
        <div style={{ marginTop: '0.85rem' }}>
          {service.metrics.map((metric) => (
            <MetricRow key={metric.label} metric={metric} />
          ))}
        </div>
      ) : (
        <p
          style={{
            fontSize: '0.78rem',
            color: 'var(--color-text-dim)',
            marginTop: '0.5rem',
          }}
        >
          {service.state === 'DOWN'
            ? 'No measurements — the service did not respond.'
            : 'No measurements available.'}
        </p>
      )}
    </div>
  );
};

export const AnalyticsPage: React.FC = () => {
  const [page, setPage] = useState(1);
  const [surface, setSurface] = useState<SlowRequestSurface>('all');
  const [routeFilter, setRouteFilter] = useState('');
  const debouncedRoute = useDebounced(routeFilter.trim(), 300);

  useEffect(() => {
    setPage(1);
  }, [debouncedRoute, surface]);

  const {
    data: infra,
    isLoading: infraLoading,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ['adminInfrastructure'],
    queryFn: () => analyticsApi.getInfrastructure(),
    // Each load probes every provider, so this is refetched on demand rather
    // than on a tight interval.
    refetchInterval: 60_000,
  });

  const { data: slow, isLoading: slowLoading } = useQuery({
    queryKey: ['adminSlowRequests', page, debouncedRoute, surface],
    queryFn: () =>
      analyticsApi.getSlowRequests({ page, route: debouncedRoute, surface }),
  });

  const meta = slow?.meta;
  const rows: SlowRequestRow[] = slow?.data ?? [];

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 className="page-title">Analytics &amp; Infrastructure</h2>
          <p className="page-subtitle">
            Live service health, resource usage, slow requests and application errors.
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isRefetching}
          className="btn-secondary"
        >
          <RefreshCw size={14} className={isRefetching ? 'spin' : ''} />
          <span>{isRefetching ? 'Probing' : 'Re-probe'}</span>
        </button>
      </div>

      {infra?.generatedAt && (
        <p
          style={{
            fontSize: '0.75rem',
            color: 'var(--color-text-dim)',
            marginBottom: '1rem',
          }}
        >
          Every figure below was measured server-side at{' '}
          {new Date(infra.generatedAt).toLocaleTimeString()}.
        </p>
      )}

      {/* SERVICE HEALTH + USAGE */}
      {infraLoading ? (
        <div
          className="glass-panel"
          style={{
            padding: '3rem',
            textAlign: 'center',
            color: 'var(--color-text-dim)',
            fontSize: '0.85rem',
          }}
        >
          Probing services...
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
            gap: '1rem',
            marginBottom: '1.5rem',
          }}
        >
          {infra?.services.map((service) => (
            <ServiceCard key={service.name} service={service} />
          ))}
        </div>
      )}

      {/* PROVIDERS THIS DEPLOYMENT CANNOT REPORT ON */}
      {infra && infra.unconfigured.length > 0 && (
        <div
          className="glass-panel"
          style={{ padding: '1.1rem 1.25rem', marginBottom: '1.5rem' }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              marginBottom: '0.5rem',
            }}
          >
            <AlertCircle size={15} color="var(--color-warning)" />
            <h3 style={{ fontSize: '0.9rem', fontWeight: 700 }}>
              Not reporting — credentials required
            </h3>
          </div>
          <p
            style={{
              fontSize: '0.8rem',
              color: 'var(--color-text-light)',
              marginBottom: '0.75rem',
            }}
          >
            These are listed rather than shown as zero. A figure appears here
            only once it can actually be read from the provider.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {infra.unconfigured.map((item) => (
              <div
                key={item.name}
                style={{
                  background: 'var(--color-bg-alt)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '0.6rem 0.85rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '0.5rem',
                }}
              >
                <span style={{ fontSize: '0.83rem', fontWeight: 600 }}>
                  {item.name}
                </span>
                <span
                  style={{
                    fontFamily: 'monospace',
                    fontSize: '0.72rem',
                    color: 'var(--color-text-dim)',
                  }}
                >
                  {item.requires.join(' · ')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SLOW REQUESTS */}
      <div className="page-header" style={{ marginTop: '0.5rem' }}>
        <div>
          <h2 className="page-title" style={{ fontSize: '1.1rem' }}>
            Slow requests
          </h2>
          <p className="page-subtitle">
            {meta
              ? `Requests over ${meta.thresholdMs} ms, recorded on the server. Kept ${meta.retentionDays} days — since ${new Date(
                  meta.windowStart,
                ).toLocaleDateString()}.`
              : 'Requests recorded on the server.'}
          </p>
        </div>
      </div>

      {/* SURFACE SECTIONS
          Admin-portal and public-app traffic are counted and paged separately:
          a 700 ms admin list query is routine, while the same figure on a
          student-facing route is a regression worth chasing. Mixing them buries
          the second kind under the first. */}
      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        {([
          { id: 'all', label: 'All traffic', Icon: Activity },
          { id: 'admin', label: 'Admin portal', Icon: ShieldCheck },
          { id: 'app', label: 'Main app', Icon: Globe },
        ] as const).map(({ id, label, Icon }) => {
          const isActive = surface === id;
          const count = meta?.surfaceCounts?.[id];
          return (
            <button
              key={id}
              onClick={() => setSurface(id)}
              className={isActive ? 'btn-primary' : 'btn-secondary'}
              style={{ padding: '0.4rem 0.85rem', fontSize: '0.82rem' }}
              aria-pressed={isActive}
            >
              <Icon size={14} />
              <span>{label}</span>
              {count !== undefined && (
                <span
                  style={{
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    fontVariantNumeric: 'tabular-nums',
                    opacity: isActive ? 0.85 : 0.6,
                  }}
                >
                  {count.toLocaleString()}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Summary of the window */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: '0.85rem',
          marginBottom: '1.25rem',
        }}
      >
        {[
          { label: 'Recorded', value: meta?.total ?? 0 },
          {
            label: 'Slowest',
            value: meta?.slowestMs ? `${meta.slowestMs} ms` : '—',
          },
          {
            label: 'Average',
            value: meta?.averageMs ? `${meta.averageMs} ms` : '—',
          },
          { label: 'Threshold', value: `${meta?.thresholdMs ?? 500} ms` },
        ].map((card) => (
          <div
            key={card.label}
            className="glass-panel"
            style={{ padding: '0.85rem 1rem' }}
          >
            <div
              style={{
                fontSize: '0.72rem',
                fontWeight: 600,
                color: 'var(--color-text-light)',
                textTransform: 'uppercase',
              }}
            >
              {card.label}
            </div>
            <div
              style={{
                fontSize: '1.25rem',
                fontWeight: 800,
                color: 'var(--color-text-main)',
                marginTop: '0.15rem',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {typeof card.value === 'number'
                ? card.value.toLocaleString()
                : card.value}
            </div>
          </div>
        ))}
      </div>

      {/* Worst offenders, grouped by route */}
      {slow?.topRoutes && slow.topRoutes.length > 0 && (
        <div
          className="glass-panel"
          style={{ padding: '1.1rem 1.25rem', marginBottom: '1.25rem' }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              marginBottom: '0.75rem',
            }}
          >
            <Timer size={15} color="var(--color-primary)" />
            <h3 style={{ fontSize: '0.9rem', fontWeight: 700 }}>
              Routes recorded most often
              {surface !== 'all' && (
                <span style={{ fontWeight: 500, color: 'var(--color-text-dim)' }}>
                  {surface === 'admin' ? ' — admin portal' : ' — main app'}
                </span>
              )}
            </h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
            {slow.topRoutes.map(
              (row: {
                route: string;
                count: number;
                avgMs: number;
                maxMs: number;
              }) => (
                <div
                  key={row.route}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '0.75rem',
                    fontSize: '0.82rem',
                    flexWrap: 'wrap',
                  }}
                >
                  <span
                    style={{
                      fontFamily: 'monospace',
                      color: 'var(--color-text-main)',
                      wordBreak: 'break-all',
                    }}
                  >
                    {row.route}
                  </span>
                  <span
                    style={{
                      color: 'var(--color-text-light)',
                      fontVariantNumeric: 'tabular-nums',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {row.count}× · avg {row.avgMs} ms · max {row.maxMs} ms
                  </span>
                </div>
              ),
            )}
          </div>
        </div>
      )}

      {/* Filter */}
      <div
        className="glass-panel"
        style={{ padding: '0.5rem 0.75rem', marginBottom: '0.85rem' }}
      >
        <input
          type="text"
          placeholder="Filter by route..."
          value={routeFilter}
          onChange={(e) => setRouteFilter(e.target.value)}
          className="input-control"
          style={{ fontSize: '0.78rem' }}
        />
      </div>

      {/* Log */}
      <div className="glass-panel" style={{ overflow: 'hidden', padding: 0 }}>
        {slowLoading ? (
          <div
            style={{
              padding: '2.5rem',
              textAlign: 'center',
              color: 'var(--color-text-dim)',
              fontSize: '0.8rem',
            }}
          >
            Loading slow requests...
          </div>
        ) : (
          <div className="table-responsive">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Route</th>
                  <th>Method</th>
                  <th style={{ textAlign: 'center' }}>Status</th>
                  <th style={{ textAlign: 'right' }}>Latency</th>
                  <th style={{ textAlign: 'right' }}>Size</th>
                  <th>Principal</th>
                  <th style={{ textAlign: 'right' }}>When</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td
                      style={{
                        fontFamily: 'monospace',
                        fontSize: '0.74rem',
                        color: 'var(--color-text-main)',
                      }}
                      title={row.path}
                    >
                      {row.route}
                    </td>
                    <td>
                      <span
                        style={{
                          fontFamily: 'monospace',
                          fontSize: '0.7rem',
                          fontWeight: 700,
                          color: METHOD_COLOR[row.method] ?? 'var(--color-text-muted)',
                        }}
                      >
                        {row.method}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span
                        className={`badge badge-${
                          row.statusCode >= 500
                            ? 'danger'
                            : row.statusCode >= 400
                              ? 'warning'
                              : 'success'
                        }`}
                      >
                        {row.statusCode}
                      </span>
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        fontVariantNumeric: 'tabular-nums',
                        fontWeight: 700,
                        fontSize: '0.74rem',
                        color:
                          row.durationMs >= 2000
                            ? 'var(--color-danger)'
                            : 'var(--color-text-main)',
                      }}
                    >
                      {row.durationMs.toLocaleString()} ms
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        fontSize: '0.72rem',
                        color: 'var(--color-text-light)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {row.bytesOut === null ? '—' : formatBytes(row.bytesOut)}
                    </td>
                    <td
                      style={{
                        fontSize: '0.7rem',
                        color: 'var(--color-text-muted)',
                        fontFamily: 'monospace',
                      }}
                    >
                      {row.adminId
                        ? `admin ${row.adminId.slice(0, 8)}`
                        : row.userId
                          ? `user ${row.userId.slice(0, 8)}`
                          : 'anonymous'}
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        fontSize: '0.68rem',
                        color: 'var(--color-text-dim)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {new Date(row.occurredAt).toLocaleString()}
                    </td>
                  </tr>
                ))}

                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      style={{
                        textAlign: 'center',
                        color: 'var(--color-text-dim)',
                        padding: '2.5rem 1rem',
                      }}
                    >
                      <Activity
                        size={22}
                        style={{ opacity: 0.4, marginBottom: '0.5rem' }}
                      />
                      <div>
                        {debouncedRoute
                          ? 'No slow requests match that route.'
                          : surface === 'admin'
                            ? 'No admin-portal request has exceeded the threshold in this window.'
                            : surface === 'app'
                              ? 'No main-app request has exceeded the threshold in this window.'
                              : 'No requests have exceeded the threshold in this window.'}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <Pagination
          page={page}
          totalPages={meta?.totalPages}
          total={meta?.total}
          onChange={setPage}
          label="slow requests"
          busy={slowLoading}
        />
      </div>

      {/* Errors sit below slow requests: both are recorded server-side and read
          together during an incident, and neither belongs on the dashboard. */}
      <ErrorLogsPanel />
    </div>
  );
};
