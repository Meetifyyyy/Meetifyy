import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Activity, AlertTriangle, Cpu, Gauge, HardDrive, Loader2, Plug, RefreshCw, Timer } from 'lucide-react';

import { TIME_WINDOWS, type TimeWindow, formatClock, formatUptime, monitoringApi } from './monitoring/monitoringApi';
import { EndpointsTable } from './monitoring/EndpointsTable';
import { RequestLogTable } from './monitoring/RequestLogTable';

/**
 * Admin -> Server Monitoring.
 *
 * Application-level observability only. The host's own dashboard already shows
 * container CPU, deploys and crashes; this shows what it cannot - which
 * endpoint is slow, which is failing, and what the process is doing between
 * deploys.
 *
 * Every panel refreshes by polling on an interval the *server* supplies, so the
 * cadence is one config value rather than a number duplicated across the
 * client. The data contract is deliberately plain request/response, so swapping
 * polling for a Socket.IO push later needs no change to these components.
 */
export const MonitoringPage: React.FC = () => {
  const [window, setWindow] = useState<TimeWindow>('24h');
  const [routeFilter, setRouteFilter] = useState<string>('');

  const overview = useQuery({
    queryKey: ['monitoringOverview'],
    queryFn: () => monitoringApi.getOverview(),
    // Falls back until the first response tells us the configured cadence.
    refetchInterval: (query) => (query.state.data as any)?.pollingIntervalMs ?? 15000,
  });

  const pollMs = overview.data?.pollingIntervalMs ?? 15000;

  const traffic = useQuery({
    queryKey: ['monitoringTimeseries', 'requests', window],
    queryFn: () => monitoringApi.getTimeseries('requests', window),
    refetchInterval: pollMs,
  });

  const latency = useQuery({
    queryKey: ['monitoringTimeseries', 'latency', window],
    queryFn: () => monitoringApi.getTimeseries('latency', window),
    refetchInterval: pollMs,
  });

  const system = useQuery({
    queryKey: ['monitoringSystem', window],
    queryFn: () => monitoringApi.getSystem(window),
    refetchInterval: pollMs,
  });

  const isDegraded = overview.data?.health === 'degraded';
  const collectionOff = overview.data?.process?.collectionEnabled === false;

  if (overview.isLoading) {
    return (
      <div style={centered}>
        <Loader2 size={20} className="spin" />
        <span>Loading monitoring data</span>
      </div>
    );
  }

  if (overview.isError) {
    return (
      <div style={centered}>
        <AlertTriangle size={22} color="var(--color-danger)" />
        <span>{(overview.error as any)?.message || 'Monitoring data could not be loaded.'}</span>
        <button className="btn-secondary" onClick={() => overview.refetch()}>
          <RefreshCw size={14} />
          <span>Try again</span>
        </button>
      </div>
    );
  }

  const o = overview.data;

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 className="page-title">Server Monitoring</h2>
          <p className="page-subtitle">
            Application-level health: per-endpoint latency, error rates and process resources.
          </p>
        </div>

        <div className="toolbar">
          <select
            className="input-control"
            style={{ padding: '0.3rem 0.5rem', fontSize: '0.78rem' }}
            value={window}
            onChange={(e) => setWindow(e.target.value as TimeWindow)}
            aria-label="Time window"
          >
            {TIME_WINDOWS.map((w) => (
              <option key={w.value} value={w.value}>
                {w.label}
              </option>
            ))}
          </select>
          {overview.isFetching && <Loader2 size={14} className="spin" style={{ color: 'var(--color-text-dim)' }} />}
        </div>
      </div>

      {collectionOff && (
        <div style={warnBanner}>
          <AlertTriangle size={15} />
          <span>
            Collection is turned off (MONITORING_ENABLED). Historical data is still readable, but nothing new is being
            recorded.
          </span>
        </div>
      )}

      {/* ── Status cards ─────────────────────────────────────────────────── */}
      <div style={cardGrid}>
        <StatCard
          icon={<Activity size={15} />}
          label="Status"
          value={isDegraded ? 'Degraded' : 'Healthy'}
          tone={isDegraded ? 'danger' : 'success'}
          hint={`Up ${formatUptime(o.process.uptimeSeconds)}${
            o.process.environmentLabel ? ` · ${o.process.environmentLabel}` : ''
          }`}
        />
        <StatCard
          icon={<Gauge size={15} />}
          label="Requests / sec"
          value={o.requestsPerSecond.toFixed(2)}
          hint={`${o.requests} in the last ${o.windowMinutes} min`}
        />
        <StatCard
          icon={<AlertTriangle size={15} />}
          label="Error rate"
          value={`${o.errorRatePercent.toFixed(1)}%`}
          tone={o.errorRatePercent > o.thresholds.errorRateWarningPercent ? 'danger' : 'default'}
          hint={`${o.errors} errors · warns above ${o.thresholds.errorRateWarningPercent}%`}
        />
        <StatCard
          icon={<Timer size={15} />}
          label="Avg latency"
          value={`${o.avgLatencyMs} ms`}
          tone={o.avgLatencyMs > o.thresholds.latencyWarningMs ? 'danger' : 'default'}
          hint={`Warns above ${o.thresholds.latencyWarningMs} ms`}
        />
        <StatCard
          icon={<Plug size={15} />}
          label="Socket clients"
          value={String(o.socketConnections)}
          hint="Live Socket.IO connections"
        />
      </div>

      {/* ── Charts ───────────────────────────────────────────────────────── */}
      <div style={chartGrid}>
        <Panel title="Throughput and errors" busy={traffic.isFetching}>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={(traffic.data?.points ?? []).map((p: any) => ({ ...p, label: formatClock(p.t, window) }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
              <XAxis dataKey="label" tick={axisTick} minTickGap={28} stroke="var(--color-border)" />
              <YAxis tick={axisTick} width={38} stroke="var(--color-border)" />
              <Tooltip contentStyle={tooltipStyle} />
              <Area type="monotone" dataKey="rps" name="req/s" stroke="#2563eb" fill="rgba(37,99,235,0.12)" strokeWidth={2} />
              <Area
                type="monotone"
                dataKey="errorRatePercent"
                name="error %"
                stroke="#dc2626"
                fill="rgba(220,38,38,0.10)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="Latency" busy={latency.isFetching}>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={(latency.data?.points ?? []).map((p: any) => ({ ...p, label: formatClock(p.t, window) }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
              <XAxis dataKey="label" tick={axisTick} minTickGap={28} stroke="var(--color-border)" />
              <YAxis tick={axisTick} width={38} stroke="var(--color-border)" unit="ms" />
              <Tooltip contentStyle={tooltipStyle} />
              {/* p95 alongside the mean: an endpoint with a good average and a
                  bad tail is a real problem the mean alone conceals. */}
              <Line type="monotone" dataKey="avgMs" name="avg" stroke="#2563eb" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="p95Ms" name="p95" stroke="#f59e0b" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      {/* ── System resources ─────────────────────────────────────────────── */}
      <SystemPanel data={system.data} busy={system.isFetching} window={window} />

      {/* ── Endpoints ────────────────────────────────────────────────────── */}
      <EndpointsTable
        window={window}
        pollMs={pollMs}
        onInspectRoute={(route) => {
          setRouteFilter(route);
          document.getElementById('monitoring-logs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }}
      />

      {/* ── Logs ─────────────────────────────────────────────────────────── */}
      <RequestLogTable pollMs={pollMs} routeFilter={routeFilter} onRouteFilterChange={setRouteFilter} />
    </div>
  );
};

// ── Pieces ─────────────────────────────────────────────────────────────────

const StatCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'success' | 'danger';
}> = ({ icon, label, value, hint, tone = 'default' }) => (
  <div className="glass-panel" style={statCard}>
    <div style={statLabel}>
      {icon}
      <span>{label}</span>
    </div>
    <div
      style={{
        ...statValue,
        color:
          tone === 'danger' ? 'var(--color-danger)' : tone === 'success' ? 'var(--color-success)' : 'var(--color-text-main)',
      }}
    >
      {value}
    </div>
    {hint && <div style={statHint}>{hint}</div>}
  </div>
);

const Panel: React.FC<{ title: string; busy?: boolean; children: React.ReactNode }> = ({ title, busy, children }) => (
  <section className="glass-panel" style={{ padding: '0.9rem 1rem 0.6rem' }}>
    <div style={panelHead}>
      <h3 style={panelTitle}>{title}</h3>
      {busy && <Loader2 size={12} className="spin" style={{ color: 'var(--color-text-dim)' }} />}
    </div>
    {children}
  </section>
);

const SystemPanel: React.FC<{ data: any; busy: boolean; window: TimeWindow }> = ({ data, busy, window }) => {
  const latest = data?.latest;
  const live = data?.live;

  return (
    <Panel title="System resources" busy={busy}>
      <div style={gaugeGrid}>
        <Gauge2 icon={<HardDrive size={14} />} label="Memory (RSS)" value={latest ? `${Math.round(latest.memoryRssMb)} MB` : '-'} hint={latest ? `${Math.round(latest.memoryHeapUsedMb)} MB heap` : undefined} />
        <Gauge2 icon={<Cpu size={14} />} label="CPU" value={latest ? `${latest.cpuPercent.toFixed(1)}%` : '-'} hint="of one core" />
        <Gauge2
          icon={<Timer size={14} />}
          label="Event loop lag"
          value={latest ? `${latest.eventLoopLagMs.toFixed(1)} ms` : '-'}
          // Lag is the symptom CPU alone will not show: a process blocked by
          // synchronous work looks busy either way, but only lag says requests
          // are queueing behind it.
          hint="queueing when high"
          tone={latest && latest.eventLoopLagMs > 50 ? 'danger' : 'default'}
        />
        <Gauge2
          icon={<Gauge size={14} />}
          label="DB pool"
          value={live ? `${live.dbPool.active} / ${live.dbPool.total}` : '-'}
          hint={live ? `${live.dbPool.idle} idle · ${live.dbPool.waiting} waiting` : undefined}
          tone={live && live.dbPool.waiting > 0 ? 'danger' : 'default'}
        />
        <Gauge2 icon={<Plug size={14} />} label="Socket clients" value={live ? String(live.socketConnections) : '-'} />
        <Gauge2
          icon={<Activity size={14} />}
          label="Write buffer"
          value={live ? String(live.buffer.requests + live.buffer.errors + live.buffer.metrics) : '-'}
          hint={live?.buffer?.dropped ? `${live.buffer.dropped} dropped` : 'rows awaiting flush'}
          tone={live?.buffer?.dropped ? 'danger' : 'default'}
        />
      </div>

      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={(data?.history ?? []).map((p: any) => ({ ...p, label: formatClock(p.createdAt, window) }))}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
          <XAxis dataKey="label" tick={axisTick} minTickGap={28} stroke="var(--color-border)" />
          <YAxis tick={axisTick} width={38} stroke="var(--color-border)" />
          <Tooltip contentStyle={tooltipStyle} />
          <Line type="monotone" dataKey="memoryRssMb" name="RSS MB" stroke="#7c3aed" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="cpuPercent" name="CPU %" stroke="#0891b2" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="socketConnections" name="sockets" stroke="#16a34a" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </Panel>
  );
};

const Gauge2: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'danger';
}> = ({ icon, label, value, hint, tone = 'default' }) => (
  <div style={gaugeCell}>
    <div style={statLabel}>
      {icon}
      <span>{label}</span>
    </div>
    <div
      style={{
        ...gaugeValue,
        color: tone === 'danger' ? 'var(--color-danger)' : 'var(--color-text-main)',
      }}
    >
      {value}
    </div>
    {hint && <div style={statHint}>{hint}</div>}
  </div>
);

// ── Styles ─────────────────────────────────────────────────────────────────

const axisTick = { fontSize: 10, fill: 'var(--color-text-light)' };

const tooltipStyle: React.CSSProperties = {
  background: 'var(--color-bg-white)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  fontSize: '0.75rem',
};

const centered: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.6rem',
  padding: '4rem 1rem',
  color: 'var(--color-text-dim)',
  fontSize: '0.85rem',
};

const warnBanner: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  padding: '0.6rem 0.85rem',
  marginBottom: '0.85rem',
  fontSize: '0.78rem',
  color: 'var(--color-warning, #b45309)',
  background: 'var(--color-warning-tint, rgba(245,158,11,0.08))',
  borderRadius: 'var(--radius-sm)',
};

const cardGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(10.5rem, 1fr))',
  gap: '0.6rem',
  marginBottom: '0.85rem',
};

const statCard: React.CSSProperties = { padding: '0.75rem 0.9rem' };

const statLabel: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.3rem',
  fontSize: '0.68rem',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--color-text-light)',
};

const statValue: React.CSSProperties = { fontSize: '1.3rem', fontWeight: 700, marginTop: '0.25rem', lineHeight: 1.1 };

const statHint: React.CSSProperties = { fontSize: '0.68rem', color: 'var(--color-text-light)', marginTop: '0.2rem' };

const chartGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(20rem, 1fr))',
  gap: '0.85rem',
  marginBottom: '0.85rem',
};

const panelHead: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.4rem',
  marginBottom: '0.6rem',
};

const panelTitle: React.CSSProperties = { margin: 0, fontSize: '0.85rem', fontWeight: 700 };

const gaugeGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(8.5rem, 1fr))',
  gap: '0.6rem',
  marginBottom: '0.9rem',
};

const gaugeCell: React.CSSProperties = {
  padding: '0.55rem 0.7rem',
  background: 'var(--color-bg-soft)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
};

const gaugeValue: React.CSSProperties = { fontSize: '1.05rem', fontWeight: 700, marginTop: '0.2rem' };
