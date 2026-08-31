import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Inbox, Loader2, MailWarning, Paperclip, RefreshCw, Search, SlidersHorizontal, X } from '../../components/icons';

import { supportApi, type TicketFilters } from './supportApi';
import {
  FILTERABLE_CATEGORIES,
  PRIORITY_BADGE,
  PRIORITY_ORDER,
  STATUS_BADGE,
  categoryLabel,
  formatRelative,
  priorityLabel,
  statusLabel,
} from './supportConstants';

const PAGE_SIZE = 20;

/**
 * The ticket queue.
 *
 * Six always-visible controls in a narrow column is mostly chrome, so only the
 * two an admin reaches for constantly stay out: search, and the open/all split.
 * The rest live behind one disclosure that carries a count, and anything
 * currently applied comes back as a removable chip - so a narrowed queue can
 * never look like an empty one.
 *
 * Filtering and sorting happen on the server. Doing it here would let the
 * counts on the tabs and the rows in the list disagree, and only the server can
 * filter across a set larger than the current page.
 */
export const TicketQueue: React.FC<{
  selectedId: string | null;
  onSelect: (id: string) => void;
  /**
   * Pins the queue to one category, for a section that only ever shows that
   * kind of request (suspension appeals). The category selector is hidden
   * rather than disabled, because a control that cannot change is noise.
   */
  lockedCategory?: string;
}> = ({ selectedId, onSelect, lockedCategory }) => {
  // `search` is seeded to '' rather than left undefined: the debounce effect
  // below runs once on mount, and `undefined === ''` was false, so it replaced
  // the filters object and fired a second identical request on every mount.
  const [filters, setFilters] = useState<TicketFilters>({
    sort: 'newest',
    page: 1,
    limit: PAGE_SIZE,
    search: '',
    ...(lockedCategory ? { category: lockedCategory } : {}),
  });
  const [searchInput, setSearchInput] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Debounced so typing a request ID does not fire a query per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((prev) => (prev.search === searchInput ? prev : { ...prev, search: searchInput, page: 1 }));
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ['adminSupportTickets', filters],
    queryFn: () => supportApi.listTickets(filters),
    // Keeps the previous page visible while the next loads, so the list does
    // not blank out between pages.
    placeholderData: (previous) => previous,
  });

  const { data: stats } = useQuery({
    queryKey: ['adminSupportStats'],
    queryFn: () => supportApi.getStats(),
    staleTime: 30 * 1000,
  });

  const setFilter = (key: keyof TicketFilters, value: string) =>
    setFilters((prev) => ({ ...prev, [key]: value, page: 1 }));

  const tickets = data?.data ?? [];
  const meta = data?.meta;

  /** Applied filters, as chips that can each be lifted individually. */
  const activeChips = useMemo(() => {
    const chips: Array<{ key: keyof TicketFilters; label: string }> = [];
    if (filters.status) chips.push({ key: 'status', label: statusLabel(filters.status) });
    if (filters.priority) chips.push({ key: 'priority', label: `${priorityLabel(filters.priority)} priority` });
    // A locked category is the section's identity, not a filter the admin
    // applied, so it gets no removable chip - lifting it would silently turn
    // the appeals section back into the full queue.
    if (filters.category && !lockedCategory) {
      chips.push({ key: 'category', label: categoryLabel(filters.category) });
    }
    if (filters.assignedAdminId === 'unassigned') chips.push({ key: 'assignedAdminId', label: 'Unassigned' });
    return chips;
  }, [filters, lockedCategory]);

  const openCount =
    (stats?.byStatus?.OPEN ?? 0) + (stats?.byStatus?.IN_PROGRESS ?? 0) + (stats?.byStatus?.WAITING_FOR_USER ?? 0);

  return (
    <div className="glass-panel" style={panel}>
      {/* ── Search ───────────────────────────────────────────────────────── */}
      <div style={searchRow}>
        <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
          <Search size={13} style={searchIcon} />
          <input
            className="input-control"
            style={searchInputStyle}
            placeholder="Search ID, email or subject"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label="Search tickets"
          />
          {searchInput && (
            <button type="button" style={clearSearch} onClick={() => setSearchInput('')} aria-label="Clear search">
              <X size={12} />
            </button>
          )}
        </div>

        <button
          type="button"
          style={{
            ...filterToggle,
            color: activeChips.length ? 'var(--color-primary)' : 'var(--color-text-light)',
            borderColor: activeChips.length ? 'var(--color-primary)' : 'var(--color-border)',
          }}
          onClick={() => setShowFilters((v) => !v)}
          aria-expanded={showFilters}
          aria-label="Filters"
          title="Filters"
        >
          <SlidersHorizontal size={13} />
          {activeChips.length > 0 && <span style={filterCount}>{activeChips.length}</span>}
        </button>
      </div>

      {/* ── Open / All ───────────────────────────────────────────────────── */}
      <div style={tabRow} role="tablist" aria-label="Ticket scope">
        <ScopeTab
          active={!filters.status}
          onClick={() => setFilter('status', '')}
          label="All"
          count={meta?.total}
        />
        <ScopeTab
          active={filters.status === 'OPEN'}
          onClick={() => setFilter('status', 'OPEN')}
          label="New"
          count={stats?.byStatus?.OPEN}
        />
        <ScopeTab
          active={filters.status === 'IN_PROGRESS'}
          onClick={() => setFilter('status', 'IN_PROGRESS')}
          label="Open"
          count={openCount || undefined}
        />
        <ScopeTab
          active={filters.status === 'RESOLVED'}
          onClick={() => setFilter('status', 'RESOLVED')}
          label="Resolved"
          count={stats?.byStatus?.RESOLVED}
        />
      </div>

      {/* ── Filter disclosure ────────────────────────────────────────────── */}
      {showFilters && (
        <div style={filterPanel}>
          <FilterSelect
            label="Priority"
            value={filters.priority ?? ''}
            onChange={(v) => setFilter('priority', v)}
            options={[
              { value: '', label: 'Any priority' },
              ...PRIORITY_ORDER.map((v) => ({ value: v, label: priorityLabel(v) })),
            ]}
          />
          {!lockedCategory && (
            <FilterSelect
              label="Category"
              value={filters.category ?? ''}
              onChange={(v) => setFilter('category', v)}
              options={[
                { value: '', label: 'Any category' },
                ...FILTERABLE_CATEGORIES.map((v) => ({ value: v, label: categoryLabel(v) })),
              ]}
            />
          )}
          <FilterSelect
            label="Assignment"
            value={filters.assignedAdminId ?? ''}
            onChange={(v) => setFilter('assignedAdminId', v)}
            options={[
              { value: '', label: 'Anyone' },
              { value: 'unassigned', label: `Unassigned${stats?.unassigned != null ? ` (${stats.unassigned})` : ''}` },
            ]}
          />
          <FilterSelect
            label="Sort"
            value={filters.sort ?? 'newest'}
            onChange={(v) => setFilter('sort', v)}
            options={[
              { value: 'newest', label: 'Newest first' },
              { value: 'oldest', label: 'Oldest first' },
              { value: 'updated', label: 'Recently updated' },
              { value: 'priority', label: 'Highest priority' },
            ]}
          />
        </div>
      )}

      {activeChips.length > 0 && (
        <div style={chipRow}>
          {activeChips.map((chip) => (
            <button key={chip.key} type="button" style={chipStyle} onClick={() => setFilter(chip.key, '')}>
              <span>{chip.label}</span>
              <X size={11} />
            </button>
          ))}
        </div>
      )}

      {stats?.failedEmails > 0 && (
        <button
          type="button"
          style={warningStrip}
          onClick={() => setFilter('status', '')}
          title="Some confirmation emails were not delivered"
        >
          <MailWarning size={12} />
          <span>
            {stats.failedEmails} email{stats.failedEmails === 1 ? '' : 's'} failed to deliver
          </span>
        </button>
      )}

      {/* ── List ─────────────────────────────────────────────────────────── */}
      <div style={list}>
        {isLoading ? (
          <div style={centered}>
            <Loader2 size={16} className="spin" />
            <span>Loading tickets</span>
          </div>
        ) : isError ? (
          <div style={centered}>
            <AlertTriangle size={18} color="var(--color-danger)" />
            <span>{(error as any)?.message || 'The queue could not be loaded.'}</span>
            <button className="btn-secondary" onClick={() => refetch()}>
              <RefreshCw size={13} />
              <span>Try again</span>
            </button>
          </div>
        ) : tickets.length === 0 ? (
          <div style={centered}>
            <Inbox size={20} />
            <span style={{ fontWeight: 600 }}>Nothing here</span>
            <span style={{ fontSize: '0.75rem' }}>
              {activeChips.length > 0 || filters.search
                ? 'No tickets match the current filters.'
                : 'Support requests will appear here as they arrive.'}
            </span>
          </div>
        ) : (
          tickets.map((ticket: any) => {
            const hasAttachments = Array.isArray(ticket.attachments) && ticket.attachments.length > 0;
            const selected = selectedId === ticket.id;

            return (
              <button
                key={ticket.id}
                type="button"
                onClick={() => onSelect(ticket.id)}
                aria-current={selected}
                style={{
                  ...row,
                  background: selected ? 'var(--color-primary-tint)' : 'transparent',
                  borderLeftColor: selected ? 'var(--color-primary)' : 'transparent',
                }}
              >
                <div style={rowTop}>
                  <span style={ticketRef}>{ticket.ticketNumber}</span>
                  <span className={`badge ${STATUS_BADGE[ticket.status] ?? 'badge-neutral'}`}>
                    {statusLabel(ticket.status)}
                  </span>
                  {(ticket.priority === 'HIGH' || ticket.priority === 'URGENT') && (
                    <span className={`badge ${PRIORITY_BADGE[ticket.priority]}`}>{priorityLabel(ticket.priority)}</span>
                  )}
                  <span style={{ marginLeft: 'auto', fontSize: '0.68rem', color: 'var(--color-text-light)' }}>
                    {formatRelative(ticket.createdAt)}
                  </span>
                </div>

                <div style={subject}>{ticket.subject}</div>

                <div style={rowBottom}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {ticket.user ? `@${ticket.user.username}` : ticket.email}
                  </span>
                  {hasAttachments && <Paperclip size={10} />}
                  {ticket.emailStatus === 'FAILED' && <MailWarning size={10} color="var(--color-danger)" />}
                  {ticket.assignedAdmin && <span style={assignee}>{ticket.assignedAdmin.name}</span>}
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* ── Pagination ───────────────────────────────────────────────────── */}
      {meta && meta.totalPages > 1 && (
        <div style={pager}>
          <button
            className="btn-secondary"
            style={pagerButton}
            disabled={meta.page <= 1 || isFetching}
            onClick={() => setFilters((prev) => ({ ...prev, page: (prev.page ?? 1) - 1 }))}
          >
            Previous
          </button>
          <span style={{ fontSize: '0.7rem', color: 'var(--color-text-light)' }}>
            {meta.page} / {meta.totalPages}
          </span>
          <button
            className="btn-secondary"
            style={pagerButton}
            disabled={meta.page >= meta.totalPages || isFetching}
            onClick={() => setFilters((prev) => ({ ...prev, page: (prev.page ?? 1) + 1 }))}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
};

const ScopeTab: React.FC<{ active: boolean; onClick: () => void; label: string; count?: number }> = ({
  active,
  onClick,
  label,
  count,
}) => (
  <button
    type="button"
    role="tab"
    aria-selected={active}
    onClick={onClick}
    style={{
      ...scopeTab,
      color: active ? 'var(--color-primary)' : 'var(--color-text-light)',
      borderBottomColor: active ? 'var(--color-primary)' : 'transparent',
      fontWeight: active ? 700 : 500,
    }}
  >
    {label}
    {count != null && count > 0 && <span style={scopeCount}>{count}</span>}
  </button>
);

const FilterSelect: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}> = ({ label, value, onChange, options }) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
    <span style={filterLabel}>{label}</span>
    <select className="input-control" style={filterSelect} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  </label>
);

// ── Styles ─────────────────────────────────────────────────────────────────

const panel: React.CSSProperties = { display: 'flex', flexDirection: 'column', overflow: 'hidden' };

const searchRow: React.CSSProperties = {
  display: 'flex',
  gap: '0.35rem',
  padding: '0.6rem 0.7rem 0.5rem',
};

const searchInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.35rem 1.7rem 0.35rem 1.9rem',
  fontSize: '0.76rem',
};

const searchIcon: React.CSSProperties = {
  position: 'absolute',
  left: '0.55rem',
  top: '50%',
  transform: 'translateY(-50%)',
  color: 'var(--color-text-dim)',
  pointerEvents: 'none',
};

const clearSearch: React.CSSProperties = {
  position: 'absolute',
  right: '0.45rem',
  top: '50%',
  transform: 'translateY(-50%)',
  display: 'inline-flex',
  border: 'none',
  background: 'none',
  color: 'var(--color-text-dim)',
  cursor: 'pointer',
  padding: 0,
};

const filterToggle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.2rem',
  flexShrink: 0,
  padding: '0 0.5rem',
  background: 'var(--color-bg-white)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
};

const filterCount: React.CSSProperties = { fontSize: '0.66rem', fontWeight: 700 };

const tabRow: React.CSSProperties = {
  display: 'flex',
  gap: '0.15rem',
  padding: '0 0.7rem',
  borderBottom: '1px solid var(--color-border)',
};

const scopeTab: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.25rem',
  padding: '0.4rem 0.4rem 0.45rem',
  fontFamily: 'inherit',
  fontSize: '0.74rem',
  background: 'none',
  border: 'none',
  borderBottom: '2px solid transparent',
  marginBottom: '-1px',
  cursor: 'pointer',
};

const scopeCount: React.CSSProperties = {
  fontSize: '0.64rem',
  fontWeight: 700,
  padding: '0.05rem 0.28rem',
  borderRadius: '9999px',
  background: 'var(--color-bg-soft)',
  color: 'var(--color-text-light)',
};

const filterPanel: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: '0.45rem',
  padding: '0.6rem 0.7rem',
  borderBottom: '1px solid var(--color-border)',
  background: 'var(--color-bg-alt)',
};

const filterLabel: React.CSSProperties = {
  fontSize: '0.62rem',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--color-text-light)',
};

const filterSelect: React.CSSProperties = { padding: '0.25rem 0.35rem', fontSize: '0.72rem', width: '100%' };

const chipRow: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.25rem',
  padding: '0.45rem 0.7rem',
  borderBottom: '1px solid var(--color-border)',
};

const chipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.25rem',
  padding: '0.15rem 0.45rem',
  fontFamily: 'inherit',
  fontSize: '0.68rem',
  color: 'var(--color-primary)',
  background: 'var(--color-primary-tint)',
  border: 'none',
  borderRadius: '9999px',
  cursor: 'pointer',
};

const warningStrip: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.35rem',
  width: '100%',
  padding: '0.4rem 0.7rem',
  fontFamily: 'inherit',
  fontSize: '0.7rem',
  textAlign: 'left',
  color: 'var(--color-danger)',
  background: 'var(--color-danger-tint, rgba(220,38,38,0.06))',
  border: 'none',
  borderBottom: '1px solid var(--color-border)',
  cursor: 'pointer',
};

const list: React.CSSProperties = { flex: 1, minHeight: 0, overflowY: 'auto' };

const centered: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '0.45rem',
  padding: '2.5rem 1.25rem',
  textAlign: 'center',
  color: 'var(--color-text-dim)',
  fontSize: '0.8rem',
};

const row: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.2rem',
  width: '100%',
  padding: '0.6rem 0.7rem',
  textAlign: 'left',
  border: 'none',
  borderLeft: '2px solid transparent',
  borderBottom: '1px solid var(--color-border)',
  cursor: 'pointer',
  transition: 'background 0.15s ease',
  font: 'inherit',
};

const rowTop: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '0.3rem', flexWrap: 'wrap' };

const ticketRef: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '0.66rem',
  fontWeight: 700,
  letterSpacing: '0.04em',
  color: 'var(--color-text-light)',
};

const subject: React.CSSProperties = {
  fontWeight: 600,
  fontSize: '0.82rem',
  color: 'var(--color-text-main)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const rowBottom: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.3rem',
  fontSize: '0.68rem',
  color: 'var(--color-text-light)',
  minWidth: 0,
};

const assignee: React.CSSProperties = {
  marginLeft: 'auto',
  flexShrink: 0,
  padding: '0.05rem 0.3rem',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--color-bg-soft)',
  fontSize: '0.64rem',
};

const pager: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.4rem',
  padding: '0.45rem 0.7rem',
  borderTop: '1px solid var(--color-border)',
  background: 'var(--color-bg-alt)',
};

const pagerButton: React.CSSProperties = { padding: '0.2rem 0.55rem', fontSize: '0.7rem' };
