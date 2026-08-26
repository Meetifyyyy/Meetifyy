import { apiRequest } from '../../api/apiClient';

/**
 * The monitoring API, in one place.
 *
 * Versioned path so this client and the server can be redeployed
 * independently without a shape change breaking the page.
 */

export type TimeWindow = '1h' | '24h' | '7d';

export const TIME_WINDOWS: Array<{ value: TimeWindow; label: string }> = [
  { value: '1h', label: 'Last hour' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
];

export interface LogFilters {
  route?: string;
  method?: string;
  status?: string;
  requestId?: string;
  page?: number;
}

function toQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    // Empty strings are how the selects express "no filter"; sending them
    // would fail the server's allow-list validation rather than being ignored.
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

const BASE = '/admin/monitoring/v1';

export const monitoringApi = {
  getOverview: () => apiRequest(`${BASE}/overview`),
  getTimeseries: (metric: 'requests' | 'errors' | 'latency', window: TimeWindow) =>
    apiRequest(`${BASE}/timeseries${toQuery({ metric, window })}`),
  getEndpoints: (window: TimeWindow) => apiRequest(`${BASE}/endpoints${toQuery({ window })}`),
  getSystem: (window: TimeWindow) => apiRequest(`${BASE}/system${toQuery({ window })}`),
  getLogs: (filters: LogFilters) => apiRequest(`${BASE}/logs${toQuery(filters as Record<string, unknown>)}`),
  getErrors: (params: { route?: string; page?: number }) =>
    apiRequest(`${BASE}/errors${toQuery(params as Record<string, unknown>)}`),
};

/** `2h 14m`, or `3d 4h` once it runs long. */
export function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '-';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function formatClock(value: string | Date, window: TimeWindow): string {
  const date = new Date(value);
  // A 7-day axis needs the date; an hour of data does not.
  return window === '7d'
    ? date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    : date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function formatDateTime(value?: string | Date | null): string {
  if (!value) return '-';
  return new Date(value).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** Colour for an HTTP status, used consistently across every table. */
export function statusBadgeClass(status: number): string {
  if (status >= 500) return 'badge-danger';
  if (status >= 400) return 'badge-warning';
  if (status >= 300) return 'badge-neutral';
  return 'badge-success';
}
