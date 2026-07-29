import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { usersApi } from '@shared/api/apiClient';
import { useAuth } from '@shared/context/AuthContext';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';
import FollowButton from '../ui/FollowButton';
import Avatar from '../avatar/Avatar';
import styles from './UserListModal.module.css';
import Skeleton from '../skeletons/Skeleton';

const PAGE_SIZE = 20;

export default function UserListModal({ type, profileUsername, onClose }) {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const observerTargetRef = useRef(null);

  useOverlayBack(true, onClose, { pushHistoryState: false });

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
                    navigate(`/profile/${user.username}`);
                    onClose();
                  }}
                >
                  <div className={styles.userAvatar}>
                    <Avatar src={user.avatar} name={user.displayName || user.username} size="42px" />
                  </div>
                  <div className={styles.userInfo}>
                    <div className={styles.userName}>{user.displayName || user.username}</div>
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
