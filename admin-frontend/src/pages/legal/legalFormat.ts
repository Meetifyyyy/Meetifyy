import { config } from '../../config';
import type { AcceptanceStats, LegalVersion } from './legalApi';

/** Short absolute date — the portal shows dates, never "3 days ago". */
export const formatDate = (value?: string | null): string =>
  value
    ? new Date(value).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : '—';

export const formatDateTime = (value?: string | null): string =>
  value
    ? new Date(value).toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

/**
 * Who wrote or shipped a version. The documents seeded by migration have no
 * admin attached, and a blank there reads as missing data.
 */
export const attribution = (admin: LegalVersion['createdBy']): string =>
  admin?.name || admin?.email || 'Meetifyy (migration)';

export const formatCount = (n: number): string => n.toLocaleString();

export const acceptancePercent = (stats: AcceptanceStats): number =>
  stats.totalActiveUsers > 0
    ? Math.min(100, Math.round((stats.acknowledged / stats.totalActiveUsers) * 100))
    : 0;

/** The public page for a document, on the website. */
export const publicUrl = (path: string, versionNumber?: number): string =>
  `${config.site.publicUrl}${path}${versionNumber ? `?version=${versionNumber}` : ''}`;

/** Today as "YYYY-MM-DD" in local time, for <input type="date">. */
export const todayInput = (offsetDays = 0): string => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** A date input's "YYYY-MM-DD" as a local calendar day, formatted like formatDate. */
export const formatDateInput = (value: string): string => {
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return '—';
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
};

/**
 * A date input's value as the ISO timestamp the API takes. Today is sent as
 * nothing at all, so the server stamps the exact moment of publication.
 */
export const effectiveAtPayload = (value: string): string | undefined => {
  if (!value || value === todayInput()) return undefined;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d).toISOString();
};

export const errorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback;

/** Names in running text: "A", "A and B", "A, B and C". */
export const joinNames = (names: string[]): string =>
  names.length <= 1
    ? names.join('')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
