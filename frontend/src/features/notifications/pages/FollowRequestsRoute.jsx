import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFollowRequests, useAnswerFollowRequest } from '@shared/hooks/useFollowRequests';
import { useOnlineStatus } from '@shared/lib/networkStatus';
import { useSystemBars } from '@shared/hooks/useSystemBars';
import { EmptyState, ErrorState, OfflineState } from '@shared/components/ui/StateViews';
import Avatar from '@shared/components/avatar/Avatar';
import PageHeader from '@layout/PageHeader';
import NotificationsLoading from '../components/NotificationsLoading';
import pageStyles from './NotificationsRoute.module.css';
import styles from './FollowRequestsRoute.module.css';

/**
 * Requests to follow the viewer's private account, answered one by one.
 * Opened from the Follow requests row on Notifications and from a
 * FOLLOW_REQUEST notification.
 */
export default function FollowRequestsRoute() {
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const loadMoreRef = useRef(null);
  // No bottom navigation here (it is under /notifications), so the list runs
  // through the device's navigation bar. No-op on the website.
  useSystemBars({ navigation: 'transparent' });

  const {
    requests, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useFollowRequests();
  const { accept, decline } = useAnswerFollowRequest();

  useEffect(() => {
    if (!loadMoreRef.current || !hasNextPage || isFetchingNextPage) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) fetchNextPage();
      },
      { rootMargin: '200px' },
    );
    observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, requests.length]);

  const openProfile = (username) =>
    navigate(`/profile/${encodeURIComponent(username)}`, { state: { from: '/notifications/follow-requests' } });

  let body;
  if (isLoading) {
    body = <NotificationsLoading label="Loading follow requests" />;
  } else if (!online && requests.length === 0) {
    body = <OfflineState message="Your follow requests will load when you are back online." />;
  } else if (isError && requests.length === 0) {
    body = <ErrorState onRetry={refetch} />;
  } else if (requests.length === 0 && !hasNextPage) {
    body = (
      <EmptyState
        title="No follow requests"
        message="Requests to follow you will show up here."
        style={{ minHeight: '40vh' }}
      />
    );
  } else {
    body = (
      <div className={pageStyles.groupItems}>
        {requests.map(({ user }) => {
          const name = user.displayName || user.username;
          return (
            <div
              key={user.id}
              className={styles.row}
              onClick={() => openProfile(user.username)}
            >
              <Avatar src={user.avatar} name={name} size="40px" />
              <div className={styles.info}>
                <span className={styles.name}>{name}</span>
                <span className={styles.username}>@{user.username}</span>
              </div>
              <div className={styles.actions} onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className={styles.accept}
                  aria-label={`Accept request from ${name}`}
                  onClick={() => accept.mutate(user.id)}
                >
                  Accept
                </button>
                <button
                  type="button"
                  className={styles.decline}
                  aria-label={`Decline request from ${name}`}
                  onClick={() => decline.mutate(user.id)}
                >
                  Decline
                </button>
              </div>
            </div>
          );
        })}
        {hasNextPage && (
          <div ref={loadMoreRef} className={styles.more}>
            {isFetchingNextPage && (
              <span className="spinner" role="status" aria-label="Loading more requests" />
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <main className="centre centre-wide animate-in">
      <div className={pageStyles.page}>
        <div className={pageStyles.headerArea}>
          <PageHeader title="Follow requests" backPath="/notifications" displayFont backOnDesktop />
        </div>
        <div className={pageStyles.list}>{body}</div>
      </div>
    </main>
  );
}
