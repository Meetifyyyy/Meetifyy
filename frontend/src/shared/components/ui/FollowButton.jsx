import { useEffect, useState } from 'react';
import { useAuth } from '@shared/context/AuthContext';
import { useFollowMutation } from '@shared/hooks/useFollowMutation';
import { toggleRegistry } from '@shared/utils/mutationRegistry';
import { followEntityKey, writeServerFollowState } from '@shared/utils/followState';
import { useFollowState } from '@shared/hooks/useFollowState';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usersApi } from '@shared/api/apiClient';
import { PROFILE_KEYS } from '@shared/hooks/useProfile';
import styles from './FollowButton.module.css';

/**
 * `initialFollowing` is AUTHORITATIVE when it is a boolean.
 *
 * Every list endpoint that renders this button now returns a real `isFollowing`
 * read from the `Follow` table, so a caller that has one should pass it
 * straight through — do NOT coerce a missing field with `|| false`. Passing
 * `undefined` means "I don't know", and the button resolves the state itself.
 * Collapsing the two is what made an already-followed account render "Follow".
 */
const FollowButton = ({ targetUsername, initialFollowing, size = 'md', className, style }) => {
  const { currentUser } = useAuth();
  const queryClient = useQueryClient();
  const [hovered, setHovered] = useState(false);
  const sizeClass = size === 'sm' ? styles.sizeSm : styles.sizeMd;

  const cleanTargetUsername = targetUsername?.toLowerCase();
  const cleanCurrentUser = currentUser?.username?.toLowerCase();
  const isSelf = !targetUsername || cleanTargetUsername === cleanCurrentUser;

  // Seed the shared follow-state entry from the caller's authoritative value.
  // In an effect rather than during render because it writes to the query
  // cache, and it is skipped while a toggle is in flight (see followState).
  useEffect(() => {
    if (isSelf) return;
    writeServerFollowState(queryClient, cleanTargetUsername, initialFollowing);
  }, [queryClient, cleanTargetUsername, initialFollowing, isSelf]);

  // The shared entry, read reactively — see useFollowState for why this is a
  // cache subscription rather than a disabled useQuery. Nothing is fetched
  // here: the entry is written by whoever holds authoritative state.
  const sharedEntry = useFollowState(cleanTargetUsername);

  // Ordering matters: the shared entry first (it carries optimistic intent and
  // every server correction), then the caller's value, then the profile
  // lookup. `??` and not `||` — `false` is an answer, not a missing value.
  const sharedState =
    sharedEntry ?? (typeof initialFollowing === 'boolean' ? initialFollowing : undefined);

  // Fallback for callers that pass nothing (a notification row, the profile
  // header): resolve the state from the target's profile.
  //
  // This used to run for EVERY button, including ones handed the answer, and
  // it used to seed the profile cache with a fabricated `{ isFollowing }` stub
  // via `initialData`. Two problems with that: the stub was written under the
  // real profile's cache key, so opening that profile read a record with no
  // name and no stats; and `initialData` is timestamped "now", so `staleTime`
  // suppressed the corrective fetch for a full minute — the button sat on a
  // guess and called it fact. `placeholderData` renders without being written
  // to the cache and without pretending to be fresh.
  const needsLookup = !isSelf && typeof sharedState !== 'boolean';
  const { data: targetProfile, isLoading: isProfileLoading } = useQuery({
    queryKey: PROFILE_KEYS.byUsername(cleanTargetUsername),
    queryFn: () => usersApi.getByUsername(targetUsername),
    enabled: needsLookup && !!cleanTargetUsername && cleanTargetUsername !== 'unknown',
    staleTime: 1000 * 60,
  });

  // Fold a profile response back into the shared entry so a second button for
  // the same account never repeats the request.
  useEffect(() => {
    if (typeof targetProfile?.isFollowing === 'boolean') {
      writeServerFollowState(queryClient, cleanTargetUsername, targetProfile.isFollowing);
    }
  }, [queryClient, cleanTargetUsername, targetProfile?.isFollowing]);

  const following =
    typeof sharedState === 'boolean'
      ? sharedState
      : Boolean(targetProfile?.isFollowing);
  const entityKey = followEntityKey(cleanTargetUsername);
  const displayFollowing = toggleRegistry.getLatestIntent(entityKey, following);

  const { follow, unfollow } = useFollowMutation(targetUsername);

  // Don't render for own profile
  if (isSelf) return null;

  // While the state is genuinely unknown. A caller that supplied it never
  // reaches here, so a seeded button paints its real label on first frame
  // instead of flashing a placeholder.
  if (needsLookup && isProfileLoading) {
    return (
      <button 
        disabled 
        className={className || `${styles.followBtn} ${sizeClass} ${styles.following}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: 0.6,
          ...style
        }}
      >
        <span style={{ transform: 'translateY(-1.5px)', display: 'inline-block', letterSpacing: '1px', fontWeight: 'bold' }}>···</span>
      </button>
    );
  }

  const handleClick = (e) => {
    e.stopPropagation();  // prevent triggering parent card clicks
    e.preventDefault();
    
    const nextFollowing = toggleRegistry.getNextToggleIntent(entityKey, following);
    if (nextFollowing) {
      follow();
    } else {
      unfollow();
    }
  };

  const label = displayFollowing ? 'Following' : 'Follow';
  const stateClass = displayFollowing ? styles.following : styles.notFollowing;

  return (
    <button
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      disabled={false} // allowed for rapid toggle
      className={className || `${styles.followBtn} ${sizeClass} ${stateClass}`.trim()}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        justifyContent: 'center',
        opacity: 1,
        cursor: 'pointer',
        ...style
      }}
    >
      {label}
    </button>
  );
};

export default FollowButton;
