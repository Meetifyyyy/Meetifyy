import { LoadingState } from '../../components/LoadingState';
import { Dropdown } from '../../components/Dropdown';
import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Inbox, MailWarning, Paperclip, RefreshCw, Search, SlidersHorizontal, X } from '../../components/icons';

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
    if (filters.type) chips.push({ key: 'type', label: filters.type === 'IDEA' ? 'Ideas' : 'Problems' });
    if (filters.assignedAdminId === 'unassigned') chips.push({ key: 'assignedAdminId', label: 'Unassigned' });
    return chips;
  }, [filters, lockedCategory]);

  // Scope buttons already communicate their selected status.
  const visibleChips = activeChips.filter((chip) => chip.key !== 'status');

  return (
    <div className="support-queue">
      {/* ── Search ───────────────────────────────────────────────────────── */}
      <div className="support-queue-search">
        <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
          <Search size={13} className="support-search-icon" />
          <input
            className="input-control support-search-input"
            placeholder="Search tickets…"
            title="Search by ticket ID, email or subject"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label="Search tickets"
          />
          {searchInput && (
            <button type="button" className="support-clear-search" onClick={() => setSearchInput('')} aria-label="Clear search">
              <X size={12} />
            </button>
          )}
        </div>

        <button
          type="button"
          className="support-filter-toggle" data-active={activeChips.length > 0}
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
      <div className="support-queue-scopes" role="group" aria-label="Ticket scope">
        <ScopeTab
          active={!filters.status}
          onClick={() => setFilter('status', '')}
          label="All"

        />
        <ScopeTab
          active={filters.status === 'OPEN'}
          onClick={() => setFilter('status', 'OPEN')}
          label="New"

        />
        <ScopeTab
          active={filters.status === 'IN_PROGRESS'}
          onClick={() => setFilter('status', 'IN_PROGRESS')}
          label="In progress"
        />
        <ScopeTab
          active={filters.status === 'RESOLVED'}
          onClick={() => setFilter('status', 'RESOLVED')}
          label="Resolved"

        />
      </div>

      {/* ── Filter disclosure ────────────────────────────────────────────── */}
      {showFilters && (
        <div className="support-queue-filters">
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
            label="Kind"
            value={filters.type ?? ''}
            onChange={(v) => setFilter('type', v)}
            options={[
              { value: '', label: 'Problems and ideas' },
              { value: 'PROBLEM', label: 'Problems' },
              { value: 'IDEA', label: 'Ideas' },
            ]}
          />
          <FilterSelect
            label="Assignment"
            value={filters.assignedAdminId ?? ''}
            onChange={(v) => setFilter('assignedAdminId', v)}
            options={[
              { value: '', label: 'Anyone' },
              { value: 'unassigned', label: 'Unassigned' },
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

      {visibleChips.length > 0 && (
        <div className="support-filter-chips">
          {visibleChips.map((chip) => (
            <button key={chip.key} type="button" className="support-filter-chip" onClick={() => setFilter(chip.key, '')}>
              <span>{chip.label}</span>
              <X size={11} />
            </button>
          ))}
        </div>
      )}

      {!lockedCategory && stats?.failedEmails > 0 && (
        <div className="support-email-warning" role="status"><MailWarning size={16} /><span>{stats.failedEmails} confirmation email{stats.failedEmails === 1 ? '' : 's'} failed to deliver across all queues. Open the affected ticket to retry.</span></div>
      )}

      <div className="support-result-count" role="status">{isFetching && !isLoading ? 'Updating tickets…' : meta ? `${meta.total} matching request${meta.total === 1 ? '' : 's'}` : ''}</div>
      <div className="support-ticket-list">
        {isLoading ? (
          <LoadingState label="Loading tickets" compact />
        ) : isError ? (
          <div className="support-empty">
            <AlertTriangle size={18} color="var(--color-danger)" />
            <span>{(error as any)?.message || 'The queue could not be loaded.'}</span>
            <button className="btn-secondary" onClick={() => refetch()}>
              <RefreshCw size={13} />
              <span>Try again</span>
            </button>
          </div>
        ) : tickets.length === 0 ? (
          <div className="support-empty">
            <Inbox size={20} />
            <span style={{ fontWeight: 600 }}>Nothing here</span>
            <span style={{ fontSize: '0.8125rem' }}>
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
                className="support-ticket"
              >
                <div className="support-ticket-meta">
                  <span className="support-ticket-ref">{ticket.ticketNumber}</span>
                  <span className={`badge ${STATUS_BADGE[ticket.status] ?? 'badge-neutral'}`}>
                    {statusLabel(ticket.status)}
                  </span>
                  {ticket.type === 'IDEA' && <span className="badge badge-info">Idea</span>}
                  {(ticket.priority === 'HIGH' || ticket.priority === 'URGENT') && (
                    <span className={`badge ${PRIORITY_BADGE[ticket.priority]}`}>{priorityLabel(ticket.priority)}</span>
                  )}
                  <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--color-text-light)' }}>
                    {formatRelative(ticket.createdAt)}
                  </span>
                </div>

                <div className="support-ticket-subject">{ticket.subject}</div>

                <div className="support-ticket-footer">
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {ticket.user ? `@${ticket.user.username}` : ticket.email}
                  </span>
                  {hasAttachments && <Paperclip size={10} />}
                  {ticket.emailStatus === 'FAILED' && <MailWarning size={10} color="var(--color-danger)" />}
                  {ticket.assignedAdmin && <span className="support-ticket-assignee">{ticket.assignedAdmin.name}</span>}
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* ── Pagination ───────────────────────────────────────────────────── */}
      {meta && meta.totalPages > 1 && (
        <div className="support-queue-pagination">
          <button
            className="btn-secondary support-page-button"
            disabled={meta.page <= 1 || isFetching}
            onClick={() => setFilters((prev) => ({ ...prev, page: (prev.page ?? 1) - 1 }))}
          >
            Previous
          </button>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-light)' }}>
            {meta.page} / {meta.totalPages}
          </span>
          <button
            className="btn-secondary support-page-button"
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
    aria-pressed={active}
    onClick={onClick}
    className="support-scope-button"
  >
    {label}
    {count != null && count > 0 && <span className="support-scope-count">{count}</span>}
  </button>
);

const FilterSelect: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}> = ({ label, value, onChange, options }) => {
  const controlId = React.useId();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
      <label htmlFor={controlId} className="support-field-label">{label}</label>
      <Dropdown id={controlId} className="input-control" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Dropdown>
    </div>
  );
};

const filterCount: React.CSSProperties = { fontSize: '0.75rem', fontWeight: 600 };
