import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { usersApi } from '@shared/api/apiClient';
import { useAuth } from '@shared/context/AuthContext';
import { CollegeRepresentativeBadge } from '@shared/components/badges/CollegeRepresentativeBadge';
import FollowButton from '../ui/FollowButton';
import Avatar from '../avatar/Avatar';
import styles from './UserListModal.module.css';
import Skeleton from '../skeletons/Skeleton';

const PAGE_SIZE = 20;

export default function UserListModal({ type, profileUsername, onClose }) {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const observerTargetRef = useRef(null);

  // This dialog deliberately does NOT register with the OverlayManager.
  //
  // It is a URL-owned sub-view: the profile opens it by pushing
  // `?tab=followers`, and that query param IS its history entry. Registering
  // here pushed a SECOND entry for the same panel, and the two then fought on
  // the way out — closing popped one step for the list and another for the
  // overlay, so a single click on the X walked past the profile and landed on
  // whatever page came before it. That is the bug: closing the list closed the
  // whole profile.
  //
  // With no entry of its own, Back simply drops the `?tab=` param, the parent
  // stops rendering this dialog, and the profile underneath is untouched.
  // Escape and the backdrop go through the same `onClose`, so all three routes
  // out behave identically.

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const isFollowers = type === 'followers';
  const cleanProfileUsername = profileUsername?.toLowerCase();
  const queryKey = [isFollowers ? 'followers' : 'following', cleanProfileUsername];

  const {
    data,
    isLoading,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam = 0 }) =>
      isFollowers
        ? usersApi.getFollowers(profileUsername, PAGE_SIZE, pageParam)
        : usersApi.getFollowing(profileUsername, PAGE_SIZE, pageParam),
    getNextPageParam: (lastPage, allPages) => {
      if (!Array.isArray(lastPage) || lastPage.length < PAGE_SIZE) {
        return undefined;
      }
      return allPages.length * PAGE_SIZE;
    },
    enabled: !!profileUsername,
    staleTime: 15_000,
  });

  const usersList = data?.pages.flatMap((page) => (Array.isArray(page) ? page : [])) || [];

  useEffect(() => {
    const target = observerTargetRef.current;
    if (!target || !hasNextPage || isFetchingNextPage) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          fetchNextPage();
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <div
      className={styles.overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h3 className={styles.title}>{type}</h3>
          <button onClick={onClose} className={styles.closeBtn} aria-label="Close modal">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className={styles.body}>
          {isLoading ? (
            <div className={styles.skeletonList}>
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className={styles.skeletonItem}>
                  <Skeleton type="circle" width="42px" height="42px" />
                  <div className={styles.skeletonTextGroup}>
                    <Skeleton type="text" width="45%" height="0.95rem" />
                    <Skeleton type="text" width="30%" height="0.8rem" />
                  </div>
                </div>
              ))}
            </div>
          ) : isError ? (
            <div className={styles.empty}>
              <p className={styles.emptyTitle}>Could not load list</p>
              <p className={styles.emptySubtitle}>Please check your connection and try again.</p>
            </div>
          ) : usersList.length === 0 ? (
            <div className={styles.empty}>
              <svg
                width="44"
                height="44"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={styles.emptyIcon}
              >
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              <p className={styles.emptyTitle}>No {type} yet</p>
              <p className={styles.emptySubtitle}>
                {isFollowers
                  ? "When someone follows this account, they'll show up here."
                  : "When this account follows someone, they'll show up here."}
              </p>
            </div>
          ) : (
            <>
              {usersList.map((user) => (
                <div
                  key={user.id || user.username}
                  className={styles.userItem}
                  onClick={() => {
                    /*
                     * Navigate ONLY. Calling the parent's `onClose` here is what
                     * stopped these rows opening a profile.
                     *
                     * This list is a history entry, not component state: the
                     * profile page opens it by pushing `?tab=followers`
                     * (useUrlState with `push: true`), so its `onClose` is a
                     * `goBack`. Running it immediately after `navigate` stepped
                     * history back over the entry that navigation had just
                     * pushed, so the tap landed on the profile and returned from
                     * it in the same tick, and nothing appeared to happen.
                     *
                     * Reordering the two would not fix it either. `goBack`
                     * navigates by delta, which the browser applies
                     * asynchronously, so a push issued straight afterwards races
                     * the pop. One navigation and no back-step is the only
                     * version with a single outcome.
                     *
                     * Closing is not lost: the list's visibility is derived from
                     * the `tab` search param, so leaving for a URL without it
                     * unmounts this modal.
                     *
                     * REPLACE, not push, and that is the part that actually
                     * makes the tap land. SmartBackTracker reconciles every
                     * arrival against its history mirror, and a PUSH onto a page
                     * already in the stack is collapsed: the mirror walks
                     * history back onto the existing entry. Tapping someone
                     * whose profile you had already opened this session
                     * therefore rendered their page and immediately stepped back
                     * over it, which is the flicker. Verified against the real
                     * mirror in browserHistoryMirror's tests: the same sequence
                     * plans a -3 step as a push and no step at all as a replace.
                     *
                     * Replacing is also the honest description of what this is.
                     * The entry being left is the open list, and the list is a
                     * sub-view of the profile, not a destination worth its own
                     * Back press once you have chosen someone from it.
                     */
                    navigate(`/profile/${user.username}`, { replace: true });
                  }}
                >
                  <div className={styles.userAvatar}>
                    <Avatar src={user.avatar} name={user.displayName || user.username} size="42px" />
                  </div>
                  <div className={styles.userInfo}>
                    <div className={styles.userName} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      {user.displayName || user.username}
                      <CollegeRepresentativeBadge isCampusRep={user.isCampusRep} user={user} size="sm" />
                    </div>
                    <div className={styles.userUsername}>@{user.username}</div>
                  </div>
                  <div className={styles.followBtnWrap} onClick={(e) => e.stopPropagation()}>
                    {user.username?.toLowerCase() !== currentUser?.username?.toLowerCase() && (
                      <FollowButton
                        targetUsername={user.username}
                        initialFollowing={user.isFollowing}
                        size="sm"
                      />
                    )}
                  </div>
                </div>
              ))}

              <div ref={observerTargetRef} className={styles.loadMoreTrigger}>
                {isFetchingNextPage && (
                  <div className={styles.spinnerWrap}>
                    <div className={styles.spinner} />
                    <span className={styles.spinnerText}>Loading more...</span>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
