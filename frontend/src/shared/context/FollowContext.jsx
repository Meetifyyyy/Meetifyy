import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { useQueryClient } from '@tanstack/react-query';
import { usersApi } from '../api/apiClient';
import { showToast } from '../utils/toast';

const FollowContext = createContext(null);

export function FollowProvider({ children }) {
  const { currentUser, updateCurrentUser } = useAuth();
  const queryClient = useQueryClient();
  const [following, setFollowing] = useState([]);
  const [pendingFollows, setPendingFollows] = useState({});

  useEffect(() => {
    if (currentUser?.followingList && Array.isArray(currentUser.followingList)) {
      setFollowing(currentUser.followingList);
    }
  }, [currentUser?.followingList]);

  const isFollowing = useCallback((uName) => {
    if (!uName) return false;
    return following.includes(uName);
  }, [following]);

  const isPending = useCallback((uName) => {
    if (!uName) return false;
    return !!pendingFollows[uName];
  }, [pendingFollows]);

  const toggleFollow = async (uName) => {
    if (!uName || uName === currentUser?.username) return;
    if (pendingFollows[uName]) return; // Prevent duplicate inflight requests / race conditions

    setPendingFollows((prev) => ({ ...prev, [uName]: true }));

    const currentlyFollowing = following.includes(uName);
    const prevFollowingList = [...following];
    const nextFollowingList = currentlyFollowing
      ? following.filter((x) => x !== uName)
      : [...following, uName];

    // Snapshot query caches for rollback
    const targetProfileKey = ['profile', uName];
    const myProfileKey = ['profile', currentUser?.username];
    const prevTargetProfile = queryClient.getQueryData(targetProfileKey);
    const prevMyProfile = currentUser?.username ? queryClient.getQueryData(myProfileKey) : null;

    // 1. Optimistic Local State Update
    setFollowing(nextFollowingList);
    if (currentUser && updateCurrentUser) {
      updateCurrentUser({
        ...currentUser,
        followingList: nextFollowingList,
        stats: {
          ...(currentUser.stats || {}),
          following: Math.max(0, (currentUser.stats?.following ?? prevFollowingList.length) + (currentlyFollowing ? -1 : 1))
        }
      });
    }

    // 2. Optimistic Cache Update for Target Profile
    if (prevTargetProfile) {
      queryClient.setQueryData(targetProfileKey, (old) => {
        if (!old) return old;
        const currentFollowers = old.stats?.followers ?? 0;
        const nextFollowers = currentlyFollowing ? Math.max(0, currentFollowers - 1) : currentFollowers + 1;
        let nextFollowersList = old.followersList || [];
        if (currentUser?.username) {
          if (currentlyFollowing) {
            nextFollowersList = nextFollowersList.filter(u => u !== currentUser.username);
          } else if (!nextFollowersList.includes(currentUser.username)) {
            nextFollowersList = [...nextFollowersList, currentUser.username];
          }
        }
        return {
          ...old,
          stats: {
            ...(old.stats || {}),
            followers: nextFollowers,
          },
          followersList: nextFollowersList,
          isFollowing: !currentlyFollowing,
        };
      });
    }

    // 3. Optimistic Cache Update for My Profile
    if (prevMyProfile) {
      queryClient.setQueryData(myProfileKey, (old) => {
        if (!old) return old;
        const currentFollowingCount = old.stats?.following ?? 0;
        const nextFollowingCount = currentlyFollowing ? Math.max(0, currentFollowingCount - 1) : currentFollowingCount + 1;
        return {
          ...old,
          stats: {
            ...(old.stats || {}),
            following: nextFollowingCount,
          },
          followingList: nextFollowingList,
        };
      });
    }

    // 4. Optimistic Cache Update for Users Query List
    queryClient.setQueryData(['users'], (oldUsers) => {
      if (!Array.isArray(oldUsers)) return oldUsers;
      return oldUsers.map(u => {
        if (u.username === uName) {
          return { ...u, isFollowing: !currentlyFollowing };
        }
        return u;
      });
    });

    try {
      let res;
      if (currentlyFollowing) {
        res = await usersApi.unfollow(uName);
      } else {
        res = await usersApi.follow(uName);
      }

      // Reconcile exact stats returned by server
      if (res?.targetUser) {
        queryClient.setQueryData(targetProfileKey, (old) => {
          if (!old) return old;
          return {
            ...old,
            stats: {
              ...(old.stats || {}),
              followers: res.targetUser.followersCount ?? old.stats?.followers,
              following: res.targetUser.followingCount ?? old.stats?.following,
            },
            isFollowing: res.isFollowing,
          };
        });
      }

      if (res?.currentUserStats && prevMyProfile) {
        queryClient.setQueryData(myProfileKey, (old) => {
          if (!old) return old;
          return {
            ...old,
            stats: {
              ...(old.stats || {}),
              following: res.currentUserStats.followingCount ?? old.stats?.following,
            },
          };
        });
      }

      // Invalidate relevant queries for eventual consistency
      queryClient.invalidateQueries({ queryKey: ['profile', uName] });
      if (currentUser?.username) {
        queryClient.invalidateQueries({ queryKey: ['profile', currentUser.username] });
        queryClient.invalidateQueries({ queryKey: ['followers', currentUser.username] });
        queryClient.invalidateQueries({ queryKey: ['following', currentUser.username] });
      }
      queryClient.invalidateQueries({ queryKey: ['followers', uName] });
      queryClient.invalidateQueries({ queryKey: ['following', uName] });
      queryClient.invalidateQueries({ queryKey: ['users'] });
    } catch (err) {
      console.error('Failed to toggle follow state', err);
      showToast(err.message || 'Action failed. Please try again.');

      // Rollback local state
      setFollowing(prevFollowingList);
      if (currentUser && updateCurrentUser) {
        updateCurrentUser({
          ...currentUser,
          followingList: prevFollowingList,
        });
      }

      // Rollback query cache
      if (prevTargetProfile) {
        queryClient.setQueryData(targetProfileKey, prevTargetProfile);
      }
      if (prevMyProfile) {
        queryClient.setQueryData(myProfileKey, prevMyProfile);
      }
      queryClient.invalidateQueries({ queryKey: ['users'] });
    } finally {
      setPendingFollows((prev) => {
        const next = { ...prev };
        delete next[uName];
        return next;
      });
    }
  };

  return (
    <FollowContext.Provider value={{ following, isFollowing, isPending, toggleFollow }}>
      {children}
    </FollowContext.Provider>
  );
}

export function useFollow() {
  const ctx = useContext(FollowContext);
  if (!ctx) throw new Error('useFollow must be used within FollowProvider');
  return ctx;
}
