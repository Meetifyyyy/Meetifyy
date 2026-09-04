import { useEffect, useRef } from 'react';
import CampusEventCard from './CampusEventCard';
import CampusEventSkeleton from './CampusEventSkeleton';
import styles from './CampusEvents.module.css';

/**
 * One always-visible discovery group (Upcoming / Ongoing / Past). Renders its
 * own loading skeletons and empty state so the three sections stay stable.
 */
export default function CampusEventSection({
  scope,
  title,
  emoji = null,
  live = false,
  events = [],
  showCount = true,
  isLoading = false,
  emptyText = 'No events yet.',
  canManage = false,
  onEdit,
  onDelete,
  hasNextPage = false,
  isFetchingNextPage = false,
  fetchNextPage,
  /**
   * Load this section's first poster eagerly, at high priority.
   *
   * Opt-in, and deliberately not automatic. When it was, every section did it —
   * and the Events page stacks three of them, so the "Past events" poster
   * (well below the fold, often below an empty "Happening now" and a full
   * "Upcoming") was fetched eagerly at high priority, competing with the poster
   * the reader could actually see. Only a page that knows which of its sections
   * comes first should ask for this.
   */
  eagerFirstPoster = false,
}) {
  const sentinelRef = useRef(null);

  // The observer reads the live paging state through a ref rather than closing
  // over it. As a dependency, `isFetchingNextPage` tore the observer down and
  // rebuilt it on both edges of every page load — two extra layout reads per
  // page, on the one interaction where the main thread is already busy.
  const pagingRef = useRef({ hasNextPage, isFetchingNextPage, fetchNextPage });
  pagingRef.current = { hasNextPage, isFetchingNextPage, fetchNextPage };

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const { hasNextPage: more, isFetchingNextPage: busy, fetchNextPage: next } = pagingRef.current;
        if (entries[0]?.isIntersecting && more && !busy) next?.();
      },
      { rootMargin: '300px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage]);

  return (
    <section className={styles.sectionGroup}>
      {title && (
        <div className={styles.groupHeader}>
          {live ? <span className={styles.liveDot} /> : emoji ? <span aria-hidden="true">{emoji}</span> : null}
          <h2 className={styles.groupTitle}>{title}</h2>
          {showCount && events.length > 0 && <span className={styles.groupCount}>{events.length}</span>}
        </div>
      )}

      {isLoading ? (
        <div className={styles.grid}>
          <CampusEventSkeleton />
          <CampusEventSkeleton />
        </div>
      ) : events.length === 0 ? (
        <div className={styles.emptyState}>
          {emoji ? <span className={styles.emptyEmoji}>{emoji}</span> : null}
          <p className={styles.emptyText}>{emptyText}</p>
        </div>
      ) : (
        <>
          <div className={styles.grid}>
            {events.map((ev, i) => (
              <CampusEventCard
                key={ev.id}
                event={ev}
                scope={scope}
                canManage={canManage}
                onEdit={onEdit}
                onDelete={onDelete}
                /* The first poster is the largest thing above the fold on a
                   phone, and `loading="lazy"` would cost it the head start the
                   preload scanner gives it — but only where this section is
                   genuinely the first thing on the page. */
                priority={eagerFirstPoster && i === 0}
              />
            ))}
          </div>
          {/* Outside `.grid`: below 640px the grid is a horizontal carousel
              whose `.grid > *` rule sizes every child to a full 215px card, so
              a sentinel placed inside it scrolled as an empty phantom slide
              after the last event. */}
          {hasNextPage && <div ref={sentinelRef} className={styles.pageSentinel} aria-hidden="true" />}
        </>
      )}
    </section>
  );
}
