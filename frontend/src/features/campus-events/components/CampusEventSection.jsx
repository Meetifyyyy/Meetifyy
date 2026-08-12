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
  emoji,
  live = false,
  events = [],
  isLoading = false,
  emptyText = 'Nothing here yet.',
  canManage = false,
  onEdit,
  onDelete,
  hasNextPage = false,
  isFetchingNextPage = false,
  fetchNextPage,
}) {
  const sentinelRef = useRef(null);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasNextPage || !fetchNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage();
      },
      { rootMargin: '300px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <section className={styles.sectionGroup}>
      <div className={styles.groupHeader}>
        {live ? <span className={styles.liveDot} /> : <span aria-hidden="true">{emoji}</span>}
        <h2 className={styles.groupTitle}>{title}</h2>
        {events.length > 0 && <span className={styles.groupCount}>{events.length}</span>}
      </div>

      {isLoading ? (
        <div className={styles.grid}>
          <CampusEventSkeleton />
          <CampusEventSkeleton />
        </div>
      ) : events.length === 0 ? (
        <div className={styles.emptyState}>
          <span className={styles.emptyEmoji}>{emoji}</span>
          <p className={styles.emptyText}>{emptyText}</p>
        </div>
      ) : (
        <div className={styles.grid}>
          {events.map((ev) => (
            <CampusEventCard
              key={ev.id}
              event={ev}
              scope={scope}
              canManage={canManage}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
          <div ref={sentinelRef} style={{ gridColumn: '1 / -1', height: 1 }} />
        </div>
      )}
    </section>
  );
}
