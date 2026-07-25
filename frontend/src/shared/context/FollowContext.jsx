import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from './AuthContext';
import { usersApi } from '../api/apiClient';
import { showToast } from '../utils/toast';

const FollowContext = createContext(null);

export const FollowProvider = ({ children }) => {
  const { currentUser } = useAuth();
  const queryClient = useQueryClient();

  // Core state: Set of usernames the current user follows
  const [followingSet, setFollowingSet] = useState(new Set());
  const [initialized, setInitialized] = useState(false);

  // ── Load following list on login ──────────────────────────────────
  useEffect(() => {
    if (!currentUser?.username) {
      // Logged out — clear everything
      setFollowingSet(new Set());
      setInitialized(false);
      return;
    }

    let cancelled = false;

    const loadFollowing = async () => {
      try {
        const usernames = await usersApi.getFollowingUsernames(currentUser.username);
        if (!cancelled) {
          setFollowingSet(new Set(usernames));
          setInitialized(true);
        }
      } catch (err) {
        console.error('[FollowContext] Failed to load following list:', err);
        if (!cancelled) {
          // Still mark initialized so UI doesn't stay in loading state forever
          setInitialized(true);
        }
      }
    };

    loadFollowing();
    return () => { cancelled = true; };
  }, [currentUser?.username]);

  // ── Selector ──────────────────────────────────────────────────────
  const isFollowing = useCallback(
    (targetUsername) => followingSet.has(targetUsername),
    [followingSet]
  );

  // ── Toggle with optimistic update + rollback ───────────────────────
  const toggleFollow = useCallback(async (targetUsername) => {
    if (!currentUser?.username || !targetUsername) return;
    if (targetUsername === currentUser.username) return; // can't follow yourself

    const wasFollowing = followingSet.has(targetUsername);

    // 1. Optimistic update — local state
    setFollowingSet((prev) => {
      const next = new Set(prev);
      if (wasFollowing) next.delete(targetUsername);
      else next.add(targetUsername);
      return next;
    });

    // 2. Optimistic update — react-query cache for profile stats
    queryClient.setQueryData(['profile', targetUsername], (old) => {
      if (!old) return old;
      return {
        ...old,
        stats: {
          ...(old.stats || {}),
          followers: wasFollowing
            ? Math.max(0, (old.stats?.followers ?? 0) - 1)
            : (old.stats?.followers ?? 0) + 1,
        }
      };
    });

    queryClient.setQueryData(['profile', currentUser.username], (old) => {
      if (!old) return old;
      return {
        ...old,
        stats: {
          ...(old.stats || {}),
          following: wasFollowing
            ? Math.max(0, (old.stats?.following ?? 0) - 1)
            : (old.stats?.following ?? 0) + 1,
        }
      };
    });

    try {
      // 3. Real API call
      if (wasFollowing) {
        await usersApi.unfollow(targetUsername);
      } else {
        await usersApi.follow(targetUsername);
      }

      // 4. Invalidate so next profile visit gets fresh data from DB
      queryClient.invalidateQueries({ queryKey: ['profile', targetUsername] });
      queryClient.invalidateQueries({ queryKey: ['profile', currentUser.username] });

    } catch (err) {
      console.error('[FollowContext] toggleFollow failed:', err);

      // 5. Rollback local state
      setFollowingSet((prev) => {
        const next = new Set(prev);
        if (wasFollowing) next.add(targetUsername);  // restore
        else next.delete(targetUsername);             // restore
        return next;
      });

      // 6. Rollback react-query cache
      queryClient.setQueryData(['profile', targetUsername], (old) => {
        if (!old) return old;
        return {
          ...old,
          stats: {
            ...(old.stats || {}),
            followers: wasFollowing
              ? (old.stats?.followers ?? 0) + 1
              : Math.max(0, (old.stats?.followers ?? 0) - 1),
          }
        };
      });
      queryClient.setQueryData(['profile', currentUser.username], (old) => {
        if (!old) return old;
        return {
          ...old,
          stats: {
            ...(old.stats || {}),
            following: wasFollowing
              ? (old.stats?.following ?? 0) + 1
              : Math.max(0, (old.stats?.following ?? 0) - 1),
          }
        };
      });

      showToast('Something went wrong. Please try again.');
    }
  }, [currentUser?.username, followingSet, queryClient]);

  return (
    <FollowContext.Provider value={{ isFollowing, toggleFollow, initialized }}>
      {children}
    </FollowContext.Provider>
  );
};

export const useFollow = () => {
  const ctx = useContext(FollowContext);
  if (!ctx) throw new Error('useFollow must be used inside FollowProvider');
  return ctx;
};
