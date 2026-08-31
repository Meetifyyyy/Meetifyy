import { apiRequest } from '../../api/apiClient';

/**
 * The analytics API, in one place.
 *
 * Both endpoints report measurements taken on the server: `infrastructure`
 * probes each service live on every call, and `slow-requests` reads rows the
 * request middleware wrote. Nothing here is derived in the browser.
 */

export type ServiceState = 'UP' | 'DOWN' | 'NOT_CONFIGURED';

export interface ServiceMetric {
  label: string;
  value: number | string;
  unit: string;
  limit?: number | null;
}

export interface ServiceReport {
  name: string;
  state: ServiceState;
  latencyMs?: number;
  detail?: string;
  metrics?: ServiceMetric[];
}

export interface InfrastructureResponse {
  generatedAt: string;
  services: ServiceReport[];
  unconfigured: Array<{ name: string; requires: string[] }>;
}

export interface SlowRequestRow {
  id: string;
  route: string;
  path: string;
  method: string;
  statusCode: number;
  durationMs: number;
  requestId: string | null;
  userId: string | null;
  adminId: string | null;
  ip: string | null;
  userAgent: string | null;
  bytesOut: number | null;
  occurredAt: string;
}

function toQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

/** Which surface recorded traffic belongs to. */
export type SlowRequestSurface = 'all' | 'admin' | 'app';

export const analyticsApi = {
  getInfrastructure: (): Promise<InfrastructureResponse> =>
    apiRequest('/admin/analytics/infrastructure'),
  getSlowRequests: (params: {
    page?: number;
    route?: string;
    method?: string;
    surface?: SlowRequestSurface;
  }) => apiRequest(`/admin/analytics/slow-requests${toQuery(params)}`),
};

/** 1.4 GB, 170 MB, 12.0 KB — three significant figures, binary units. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const power = Math.min(
    units.length - 1,
    Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024)),
  );
  const value = bytes / 1024 ** power;
  return `${value.toFixed(power === 0 ? 0 : value >= 100 ? 0 : 1)} ${units[power]}`;
}

export function formatMetric(metric: ServiceMetric): string {
  if (typeof metric.value === 'string') return metric.value;
  switch (metric.unit) {
    case 'bytes':
      return formatBytes(metric.value);
    case 'ms':
      return `${Math.round(metric.value)} ms`;
    case 'percent':
      return `${metric.value}%`;
    default:
      return metric.value.toLocaleString();
  }
}

/** Fraction of a metric's ceiling, or null where the provider publishes none. */
export function usageRatio(metric: ServiceMetric): number | null {
  if (typeof metric.value !== 'string' && metric.limit) {
    return Math.min(1, metric.value / metric.limit);
  }
  return null;
}
