import React, { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, RefreshCw, Server, Timer, AlertCircle, ShieldCheck, Globe, Search, X, CheckCircle } from '../components/icons';
import { analyticsApi, formatBytes, formatMetric, usageRatio, type ServiceMetric, type ServiceReport, type ServiceState, type SlowRequestRow, type SlowRequestSurface } from './analytics/analyticsApi';
import { Pagination } from '../components/Pagination';
import { LoadingState } from '../components/LoadingState';
import { useDebounced } from '../hooks/useDebounced';
import { AnalyticsError } from './analytics/AnalyticsError';
import { ErrorLogsPanel } from './analytics/ErrorLogsPanel';
import './analytics/analytics.css';

const STATE_LABEL: Record<ServiceState, string> = { UP: 'Operational', DOWN: 'Unavailable', NOT_CONFIGURED: 'Not configured' };
const METHOD_COLOR: Record<string, string> = { GET: 'var(--color-primary)', POST: 'var(--color-success)', PATCH: 'var(--color-warning)', PUT: 'var(--color-warning)', DELETE: 'var(--color-danger)' };

const MetricRow: React.FC<{ metric: ServiceMetric }> = ({ metric }) => {
  const ratio = usageRatio(metric);
  const percentage = ratio === null ? null : Math.round(Math.max(0, ratio) * 100);
  const limit = metric.limit ? metric.unit === 'bytes' ? formatBytes(metric.limit) : metric.limit.toLocaleString() : null;
  return (
    <div className={`analytics-metric${ratio !== null && ratio >= .8 ? ' is-near-limit' : ''}`}>
      <div className="analytics-metric-line"><span>{metric.label}</span><span><strong>{formatMetric(metric)}</strong>{limit && <small> / {limit}</small>}</span></div>
      {percentage !== null && <div className="analytics-usage-track" role="progressbar" aria-label={metric.label}
        aria-valuenow={percentage} aria-valuemin={0} aria-valuemax={100} aria-valuetext={`${formatMetric(metric)} of ${limit}`}>
        <span style={{ width: `${percentage}%` }} />
      </div>}
    </div>
  );
};

const ServiceCard: React.FC<{ service: ServiceReport }> = ({ service }) => (
  <article className={`analytics-service-card state-${service.state.toLowerCase()}${(service.metrics?.length ?? 0) > 6 ? ' analytics-service-card-tall' : ''}`}>
    <div className="analytics-service-heading">
      <div className="analytics-service-title"><span className="analytics-service-icon"><Server size={19} aria-hidden="true" /></span><h3>{service.name}</h3></div>
      <span className={`analytics-pill state-${service.state.toLowerCase()}`}>{STATE_LABEL[service.state]}</span>
    </div>
    <div className="analytics-service-meta">
    {service.latencyMs !== undefined && <p className="analytics-service-latency"><Timer size={13} aria-hidden="true" />Response <strong>{service.latencyMs.toLocaleString()} ms</strong></p>}
    {service.detail && <p className="analytics-service-detail">{service.detail}</p>}
    </div>
    {service.metrics?.length ? <div className="analytics-service-metrics">{service.metrics.map((metric) => <MetricRow key={metric.label} metric={metric} />)}</div>
      : <p className="analytics-no-measurements">{service.state === 'DOWN' ? 'No measurements — the service did not respond.' : 'No measurements available.'}</p>}
  </article>
);

export const AnalyticsPage: React.FC = () => {
  const [page, setPage] = useState(1);
  const [surface, setSurface] = useState<SlowRequestSurface>('all');
  const [routeFilter, setRouteFilter] = useState('');
  const routeSearchRef = useRef<HTMLInputElement>(null);
  const debouncedRoute = useDebounced(routeFilter.trim(), 300);
  useEffect(() => { setPage(1); }, [debouncedRoute, surface]);
  const { data: infra, isLoading: infraLoading, error: infraError, refetch, isRefetching } = useQuery({
    queryKey: ['adminInfrastructure'], queryFn: () => analyticsApi.getInfrastructure(), refetchInterval: 60_000,
  });
  const { data: slow, isLoading: slowLoading, isFetching: slowFetching, error: slowError, refetch: refetchSlow } = useQuery({
    queryKey: ['adminSlowRequests', page, debouncedRoute, surface],
    queryFn: () => analyticsApi.getSlowRequests({ page, route: debouncedRoute, surface }),
  });
  useEffect(() => {
    if (slow?.meta?.totalPages !== undefined && page > Math.max(1, slow.meta.totalPages)) setPage(Math.max(1, slow.meta.totalPages));
  }, [slow?.meta?.totalPages, page]);
  const meta = slow?.meta;
  const rows: SlowRequestRow[] = slow?.data ?? [];
  const notReporting = new Set([...(infra?.unconfigured.map((item) => item.name) ?? []), ...(infra?.services.filter((service) => service.state === 'NOT_CONFIGURED').map((service) => service.name) ?? [])]).size;
  const infraValue = (value: number) => infraLoading ? '…' : !infra ? '—' : value.toLocaleString();
  const slowValue = (value: string | number | undefined) => slowLoading ? '…' : !slow ? '—' : typeof value === 'number' ? value.toLocaleString() : value ?? '—';

  return (
    <div className="admin-page analytics-page">
      <div className="page-header analytics-page-header">
        <div><h2 className="page-title">Analytics &amp; Infrastructure</h2><p className="page-subtitle">Service health, resource usage, and application performance.</p></div>
        <button onClick={() => refetch()} disabled={infraLoading || isRefetching} className="btn-secondary analytics-refresh-button" aria-label="Refresh service metrics" title="Refresh services">
          <RefreshCw size={16} className={isRefetching ? 'spin' : ''} /><span>{isRefetching ? 'Checking services…' : 'Refresh services'}</span>
        </button>
      </div>

      <div className="analytics-overview-grid" aria-label="Service health summary">
        {[
          { label: 'Operational services', value: infraValue(infra?.services.filter((service) => service.state === 'UP').length ?? 0), tone: 'green', icon: CheckCircle },
          { label: 'Unavailable services', value: infraValue(infra?.services.filter((service) => service.state === 'DOWN').length ?? 0), tone: 'peach', icon: AlertCircle },
          { label: 'Not reporting', value: infraValue(notReporting), tone: 'blue', icon: Server },
        ].map(({ label, value, tone, icon: Icon }) => <dl key={label} className={`analytics-stat tone-${tone}`}><dt><span>{label}</span><Icon size={20} aria-hidden="true" /></dt><dd>{value}</dd></dl>)}
      </div>

      <div className="analytics-section-heading"><div><h3>Service health &amp; usage</h3><p>Live measurements from each connected provider.</p></div>
        {infra?.generatedAt && <span className="analytics-checked">Last checked <time dateTime={infra.generatedAt}>{new Date(infra.generatedAt).toLocaleTimeString()}</time></span>}
      </div>
      {infraError && <AnalyticsError message={(infraError as Error).message || 'Service measurements are unavailable.'} retry={() => refetch()} />}
      <section className="analytics-infrastructure" aria-label="Infrastructure health and usage" aria-busy={infraLoading || isRefetching}>
        {infraLoading ? <LoadingState label="Loading service metrics…" /> : <div className="analytics-service-grid">{infra?.services.map((service) => <ServiceCard key={service.name} service={service} />)}</div>}
        {isRefetching && !infraLoading && <div className="analytics-service-refresh" role="status"><span className="analytics-loading-spinner spin" aria-hidden="true" /><span>Refreshing service metrics…</span></div>}
      </section>
      {infra && infra.unconfigured.length > 0 && <section className="analytics-unconfigured" aria-labelledby="analytics-unconfigured-title">
        <div className="analytics-section-heading"><div><h3 id="analytics-unconfigured-title">Providers not reporting</h3><p>Connect provider access to show usage metrics.</p></div><AlertCircle size={18} aria-hidden="true" /></div>
        <ul>{infra.unconfigured.map((item) => <li key={item.name}><strong>{item.name}</strong><span className="analytics-provider-requirements">{item.requires.map((requirement) => <code key={requirement}>{requirement}</code>)}</span></li>)}</ul>
      </section>}

      <section className="analytics-performance-section" aria-labelledby="analytics-performance-title">
        <div className="analytics-section-heading"><div><h3 id="analytics-performance-title">Slow requests</h3><p>{meta ? `Over ${meta.thresholdMs} ms · ${meta.retentionDays}-day retention · Since ${new Date(meta.windowStart).toLocaleDateString()}` : 'Requests recorded by the server.'}</p></div></div>
        <div className="analytics-traffic-controls">
          <div className="analytics-traffic-tabs" aria-label="Filter requests by application">
            {([{ id: 'all', label: 'All traffic', Icon: Activity }, { id: 'admin', label: 'Admin portal', Icon: ShieldCheck }, { id: 'app', label: 'Main app', Icon: Globe }] as const).map(({ id, label, Icon }) => (
              <button key={id} onClick={() => { setSurface(id); setPage(1); }} aria-pressed={surface === id}>
                <Icon size={15} aria-hidden="true" /><span>{label}</span>{meta?.surfaceCounts?.[id] !== undefined && <small title={meta.surfaceCounts[id].toLocaleString()}>{new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(meta.surfaceCounts[id])}</small>}
              </button>
            ))}
          </div>
        </div>
        <div className="analytics-request-summary" aria-label="Slow request statistics">
          {[
            { label: 'Recorded requests', value: slowValue(meta?.total), tone: 'blue' },
            { label: 'Slowest request', value: slowValue(meta?.slowestMs == null ? undefined : `${meta.slowestMs.toLocaleString()} ms`), tone: 'peach' },
            { label: 'Average latency', value: slowValue(meta?.averageMs == null ? undefined : `${meta.averageMs.toLocaleString()} ms`), tone: 'violet' },
            { label: 'Capture threshold', value: slowValue(meta?.thresholdMs == null ? undefined : `${meta.thresholdMs.toLocaleString()} ms`), tone: 'green' },
          ].map(({ label, value, tone }) => <dl className={`analytics-stat tone-${tone}`} key={label}><dt>{label}</dt><dd>{value.endsWith(' ms') ? <><span>{value.slice(0, -3)}</span><small className="analytics-stat-unit"> ms</small></> : value}</dd></dl>)}
        </div>
        {slowError && <AnalyticsError message={(slowError as Error).message || 'Slow requests are unavailable.'} retry={() => refetchSlow()} />}

        {slow?.topRoutes?.length > 0 && <section className="analytics-top-routes" aria-label="Routes recorded most often"><div className="analytics-section-heading"><h4><Timer size={17} aria-hidden="true" />Routes recorded most often</h4></div>
          <ol>{slow.topRoutes.map((row: { route: string; count: number; avgMs: number; maxMs: number }) => <li key={row.route}><code>{row.route}</code><div className="analytics-route-numbers"><span><strong>{row.count.toLocaleString()}×</strong> recorded</span><span>Avg <strong>{row.avgMs.toLocaleString()} ms</strong></span><span>Max <strong>{row.maxMs.toLocaleString()} ms</strong></span></div></li>)}</ol>
        </section>}

        <div className="analytics-search"><Search size={18} aria-hidden="true" /><input ref={routeSearchRef} type="search" aria-label="Filter slow requests by route" placeholder="Filter by route…" value={routeFilter} onChange={(event) => setRouteFilter(event.target.value)} autoCapitalize="none" spellCheck={false} className="input-control" />
          {routeFilter && <button onClick={() => { setRouteFilter(''); routeSearchRef.current?.focus({ preventScroll: true }); }} aria-label="Clear route filter"><X size={17} /></button>}
        </div>
        <div className="analytics-log-panel" aria-busy={slowFetching}>
          {slowLoading ? <LoadingState label="Loading slow requests…" /> : rows.length === 0 ? <div className="analytics-empty"><Activity size={28} aria-hidden="true" /><h4>{slowError ? 'Requests unavailable' : 'No matching slow requests'}</h4><p>{slowError ? 'Try loading the request list again.' : 'No requests match these filters in the current recording window.'}</p></div> : (
            <table className="analytics-table analytics-slow-table" role="table" aria-label="Slow request log">
              <thead><tr><th>Route</th><th>Method</th><th>Status</th><th>Latency</th><th>Size</th><th>Principal</th><th>When</th></tr></thead>
              <tbody>{rows.map((row) => <tr key={row.id}>
                <td className="slow-cell-route" title={row.path}><code>{row.route}</code></td>
                <td className="slow-cell-method"><span className="analytics-method" style={{ color: METHOD_COLOR[row.method] ?? 'var(--color-text-muted)' }}>{row.method}</span></td>
                <td className="slow-cell-status"><span className={`analytics-pill ${row.statusCode >= 500 ? 'tone-danger' : row.statusCode >= 400 ? 'tone-warning' : 'state-up'}`}>{row.statusCode}</span></td>
                <td className={`slow-cell-latency${row.durationMs >= 2000 ? ' is-slow' : ''}`}>{row.durationMs.toLocaleString()} ms</td>
                <td className="slow-cell-size">{row.bytesOut === null ? '—' : formatBytes(row.bytesOut)}</td>
                <td className="slow-cell-principal">{row.adminId ? `admin ${row.adminId.slice(0, 8)}` : row.userId ? `user ${row.userId.slice(0, 8)}` : 'anonymous'}</td>
                <td className="slow-cell-date"><time dateTime={row.occurredAt}>{new Date(row.occurredAt).toLocaleString()}</time></td>
              </tr>)}</tbody>
            </table>
          )}
          <Pagination page={page} totalPages={meta?.totalPages} total={meta?.total} onChange={setPage} label="slow requests" busy={slowFetching} />
        </div>
      </section>
      <ErrorLogsPanel />
    </div>
  );
};
