import type { LegalVersion } from './legalApi';

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
 * Who wrote or shipped a version.
 *
 * The four documents seeded with the feature have no admin attached — they were
 * imported from the frontend, not authored in the portal — and a blank cell
 * there reads as missing data rather than as the fact it is.
 */
export const attribution = (admin: LegalVersion['createdBy']): string =>
  admin?.name || admin?.email || 'Meetifyy (imported)';

export const STATUS_STYLE: Record<
  string,
  { bg: string; fg: string; label: string }
> = {
  PUBLISHED: {
    bg: 'rgba(34, 197, 94, 0.18)',
    fg: '#22c55e',
    label: 'Published',
  },
  DRAFT: { bg: 'rgba(234, 179, 8, 0.18)', fg: '#eab308', label: 'Draft' },
  ARCHIVED: {
    bg: 'rgba(148, 163, 184, 0.18)',
    fg: '#94a3b8',
    label: 'Archived',
  },
};

/**
 * A line-level diff between the published text and the draft.
 *
 * Deliberately naive — a longest-common-subsequence over block-level chunks —
 * because the job is "show an admin what changed before they publish it", not
 * to be a merge tool. Anything cleverer would need a dependency, and this runs
 * on two documents of a few hundred lines.
 */
export type DiffRow = { type: 'same' | 'added' | 'removed'; text: string };

/** Splits sanitized HTML into readable block-level chunks. */
export function toBlocks(html: string): string[] {
  return (html || '')
    .replace(/></g, '>\n<')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function diffBlocks(before: string, after: string): DiffRow[] {
  const a = toBlocks(before);
  const b = toBlocks(after);

  // Standard LCS table. Both inputs are block lists, not characters, so this
  // stays small even for a long policy.
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      rows.push({ type: 'same', text: a[i] });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      rows.push({ type: 'removed', text: a[i] });
      i += 1;
    } else {
      rows.push({ type: 'added', text: b[j] });
      j += 1;
    }
  }
  while (i < a.length) {
    rows.push({ type: 'removed', text: a[i] });
    i += 1;
  }
  while (j < b.length) {
    rows.push({ type: 'added', text: b[j] });
    j += 1;
  }
  return rows;
}

/** Strips tags for the diff view, which is about words rather than markup. */
export const blockText = (block: string): string =>
  block
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
