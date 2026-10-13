import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer, useWindowVirtualizer } from '@tanstack/react-virtual';
import { EmptyState } from '@shared/components/ui/StateViews';
import NotificationItem from './NotificationItem';
import { useUsersMap } from '@shared/hooks/useUsersMap';

export default function NotificationList({
  groupedNotifications,
  timeAgo,
  onNotifClick,
  pageStyles,
  scrollElement
}) {
  const users = useUsersMap();

  /**
   * username -> user, built once per change of the users map.
   *
   * `resolveActor` fell back to `Object.values(users).find(u => u.username ===
   * ...)` for any notification whose actor id is not in the map — a full scan
   * of every user the client knows, per row, on every render. Virtualisation
   * keeps that to the dozen or so visible rows, but it still ran on every
   * scroll frame, and it grows with the size of the users map rather than with
   * the list.
   */
  const usersByUsername = useMemo(() => {
    const index = new Map();
    for (const user of Object.values(users || {})) {
      if (user?.username) index.set(user.username, user);
    }
    return index;
  }, [users]);

  const resolveActor = useCallback((notif) => {
    const actorId = notif.actor?.id || notif.actorId || notif.metadata?.actorId;
    const actorUsername = notif.actor?.username || notif.metadata?.actorUsername;

    // getUserById was defined as exactly `users[id] || null` over this same map.
    let liveUser = (actorId && users?.[actorId]) || null;
    if (!liveUser && actorUsername) {
      liveUser = usersByUsername.get(actorUsername) || null;
    }

    if (liveUser) {
      return {
        name: liveUser.displayName || liveUser.username || 'Someone',
        avatar: liveUser.avatar,
        username: liveUser.username || '',
        isLive: true
      };
    }

    if (notif.actor && (notif.actor.displayName || notif.actor.username)) {
      return {
        name: notif.actor.displayName || notif.actor.username,
        avatar: notif.actor.avatar,
        username: notif.actor.username || '',
        hasActor: true
      };
    }

    if (notif.metadata?.actorDisplayName || notif.metadata?.actorName || notif.metadata?.actorUsername) {
      return { 
        name: notif.metadata.actorDisplayName || notif.metadata.actorName || notif.metadata.actorUsername, 
        avatar: notif.metadata.actorAvatar || '',
        username: notif.metadata.actorUsername || '' 
      };
    }

    return { name: 'Someone', avatar: '', username: '' };
  }, [users, usersByUsername]);

  const formatTimeStr = (createdAt) => {
    return timeAgo(createdAt)
      .replace(' ago', '')
      .replace('Yesterday', '1d')
      .replace('just now', 'now')
      .replace(' seconds', 's')
      .replace(' second', 's')
      .replace(' minutes', 'm')
      .replace(' minute', 'm')
      .replace(' hours', 'h')
      .replace(' hour', 'h')
      .replace(' days', 'd')
      .replace(' day', 'd')
      .replace(' weeks', 'w')
      .replace(' week', 'w');
  };

  const flatItems = useMemo(() => {
    const list = [];
    groupedNotifications.forEach(group => {
      list.push({ type: 'header', key: `header-${group.key}`, title: group.title });
      group.items.forEach(notif => {
        list.push({ type: 'item', key: notif.id, notif });
      });
    });
    return list;
  }, [groupedNotifications]);

  /**
   * One actor object per row, rebuilt only when the rows or the users map
   * change — not on every render.
   *
   * `actor` is an object, so resolving it inline in the render loop handed
   * every row a brand-new reference each time and made `React.memo` on
   * NotificationItem useless: nothing would ever compare equal. Scrolling
   * re-rendered every visible row for that reason alone.
   *
   * `timeStr` is deliberately NOT cached here. It is a string, so it compares
   * by value and memo skips the row anyway while it reads the same — and
   * caching it would freeze relative timestamps at whatever they said when the
   * list last changed.
   */
  const actorsById = useMemo(() => {
    const map = new Map();
    for (const item of flatItems) {
      if (item.type === 'item') map.set(item.key, resolveActor(item.notif));
    }
    return map;
  }, [flatItems, resolveActor]);

  if (groupedNotifications.length === 0) {
    return (
      <EmptyState
        title="All caught up!"
        message="You have no new notifications right now."
        style={{ minHeight: '60vh' }}
        icon={
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '1rem', opacity: 0.5 }}>
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        }
      />
    );
  }

  const rowProps = { flatItems, actorsById, formatTimeStr, onNotifClick, pageStyles };

  // Which element scrolls decides the virtualizer. On a desktop the page card
  // is its own scroller; on a phone (and in the app) it is not, and the window
  // scrolls instead. Virtualising against a non-scrolling element never sees a
  // scroll, so rows past the first screen were never rendered.
  if (!scrollElement) return null;
  return isScrollContainer(scrollElement) ? (
    <ElementRows scrollElement={scrollElement} {...rowProps} />
  ) : (
    <WindowRows {...rowProps} />
  );
}

function isScrollContainer(el) {
  return /(auto|scroll|overlay)/.test(window.getComputedStyle(el).overflowY);
}

const estimateSizeFor = (flatItems) => (index) =>
  flatItems[index]?.type === 'header' ? (index === 0 ? 38 : 52) : 68;

function ElementRows({ scrollElement, flatItems, ...rest }) {
  const virtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => scrollElement,
    estimateSize: estimateSizeFor(flatItems),
    overscan: 6,
  });
  return <Rows virtualizer={virtualizer} flatItems={flatItems} offset={0} {...rest} />;
}

function WindowRows({ flatItems, ...rest }) {
  const listRef = useRef(null);
  // The list's distance from the top of the document: the window virtualizer
  // counts from there.
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return undefined;
    const measure = () => {
      const top = Math.round(el.getBoundingClientRect().top + window.scrollY);
      setScrollMargin((prev) => (prev === top ? prev : top));
    };
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(document.body);
    return () => observer?.disconnect();
  }, []);

  const virtualizer = useWindowVirtualizer({
    count: flatItems.length,
    estimateSize: estimateSizeFor(flatItems),
    overscan: 6,
    scrollMargin,
    // Rows mount while the user scrolls; a synchronous flush made each one a
    // layout inside the scroll frame.
    useFlushSync: false,
  });
  return (
    <Rows virtualizer={virtualizer} flatItems={flatItems} offset={scrollMargin} listRef={listRef} {...rest} />
  );
}

function Rows({ virtualizer, flatItems, offset, listRef, actorsById, formatTimeStr, onNotifClick, pageStyles }) {
  return (
    <div
      ref={listRef}
      className={pageStyles.groupItems}
      style={{
        height: `${virtualizer.getTotalSize()}px`,
        position: 'relative',
        width: '100%',
      }}
    >
      {virtualizer.getVirtualItems().map((virtualItem) => {
        const item = flatItems[virtualItem.index];

        return (
          <div
            key={virtualItem.key}
            data-index={virtualItem.index}
            ref={virtualizer.measureElement}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualItem.start - offset}px)`,
            }}
          >
            {item.type === 'header' ? (
              <h2
                className={`${pageStyles.groupTitle} ${virtualItem.index > 0 ? pageStyles.groupTitleDivided : ''}`}
              >
                {item.title}
              </h2>
            ) : (
              <NotificationItem
                notif={item.notif}
                actor={actorsById.get(item.key)}
                timeStr={formatTimeStr(item.notif.createdAt)}
                onClick={onNotifClick}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
