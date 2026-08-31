import React from 'react';
import { ChevronLeft, ChevronRight } from './icons';

/**
 * Page control for the admin list views.
 *
 * Every list endpoint here is paginated and returns `meta.totalPages`, but the
 * pages that consumed them held `page` in a `useState` whose setter was never
 * wired to anything — so records past the first 20 were reachable only by
 * editing the URL by hand. This renders nothing when there is a single page,
 * so adding it to a short list costs no visual noise.
 */
export const Pagination: React.FC<{
  page: number;
  totalPages?: number;
  total?: number;
  onChange: (page: number) => void;
  /** Shown as "… of N <label>" — e.g. "users", "colleges". */
  label?: string;
  busy?: boolean;
}> = ({ page, totalPages, total, onChange, label = 'records', busy = false }) => {
  const pages = totalPages ?? 1;
  if (pages <= 1) return null;

  const btn = (disabled: boolean): React.CSSProperties => ({
    padding: '0.3rem 0.6rem',
    fontSize: '0.78rem',
    opacity: disabled ? 0.45 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
  });

  const atStart = page <= 1 || busy;
  const atEnd = page >= pages || busy;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '0.75rem',
        padding: '0.7rem 1rem',
        borderTop: '1px solid var(--color-border)',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ fontSize: '0.78rem', color: 'var(--color-text-light)' }}>
        Page {page} of {pages}
        {total !== undefined && ` · ${total.toLocaleString()} ${label}`}
      </div>
      <div style={{ display: 'flex', gap: '0.35rem' }}>
        <button
          onClick={() => onChange(page - 1)}
          disabled={atStart}
          className="btn-secondary"
          style={btn(atStart)}
        >
          <ChevronLeft size={13} />
          <span>Previous</span>
        </button>
        <button
          onClick={() => onChange(page + 1)}
          disabled={atEnd}
          className="btn-secondary"
          style={btn(atEnd)}
        >
          <span>Next</span>
          <ChevronRight size={13} />
        </button>
      </div>
    </div>
  );
};
