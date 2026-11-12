import { useEffect, useState } from 'react';
import { useAuth } from '@shared/context/AuthContext';
import { useFollowMutation } from '@shared/hooks/useFollowMutation';
import { toggleRegistry } from '@shared/utils/mutationRegistry';
import {
  FOLLOW_REQUESTED,
  followEntityKey,
  followEntryGeneratedAt,
  isFollowOn,
  isFollowStateValue,
  readFollowState,
  writeServerFollowState,
} from '@shared/utils/followState';
import { useFollowState } from '@shared/hooks/useFollowState';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usersApi } from '@shared/api/apiClient';
import { PROFILE_KEYS, profileRequestedAt, stampRequestedAt } from '@shared/hooks/useProfile';
import UnfollowModal from '@shared/components/modals/UnfollowModal';
import styles from './FollowButton.module.css';

/**
 * Three states: Follow, Requested (a private account has not answered yet) and
 * Following. Tapping Follow on a private account turns it into Requested, not
 * Following; tapping Requested withdraws the request with no question asked;
 * tapping Following asks first, as before.
 *
 * `initialFollowing` is AUTHORITATIVE when it is a boolean.
 *
 * Every list endpoint that renders this button now returns a real `isFollowing`
 * read from the `Follow` table, so a caller that has one should pass it
 * straight through — do NOT coerce a missing field with `|| false`. Passing
 * `undefined` means "I don't know", and the button resolves the state itself.
 * Collapsing the two is what made an already-followed account render "Follow".
 */
/** The follow state a profile payload reports. */
function profileFollowState(profile) {
  if (profile?.isFollowing) return true;
  return profile?.followRequested === true ? FOLLOW_REQUESTED : false;
}

const FollowButton = ({ targetUsername, initialFollowing, size = 'md', className, style }) => {
  const { currentUser } = useAuth();
  const queryClient = useQueryClient();
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
  // The entry is `true`, `false` or `'requested'`. A list row's
  // `initialFollowing` is a boolean: it knows "following" and "not", never
  // "requested", so on a row the button shows Follow for an account the viewer
  // has already requested until it is tapped (the server then says Requested
  // again, without notifying the account twice).
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
  const needsLookup = !isSelf && !isFollowStateValue(sharedState);
  const {
    data: targetProfile,
    isLoading: isProfileLoading,
    dataUpdatedAt: targetProfileUpdatedAt,
  } = useQuery({
    queryKey: PROFILE_KEYS.byUsername(cleanTargetUsername),
    queryFn: async () => {
      // Same stamp as useProfile's fetch: the start of THIS request, so a
      // lookup that began before a tap cannot outrank it when it resolves after.
      const requestedAt = Date.now();
      return stampRequestedAt(await usersApi.getByUsername(targetUsername), requestedAt);
    },
    enabled: needsLookup && !!cleanTargetUsername && cleanTargetUsername !== 'unknown',
    staleTime: 1000 * 60,
  });

  /**
   * Fold a profile response into the shared entry -- the first answer for an
   * unknown, and every NEWER answer after that.
   *
   * This used to be gated on `needsLookup` ("the lookup only ANSWERS an
   * unknown, never corrects a known"). The gate fixed a real regression: a
   * DISABLED `useQuery` still returns whatever sits under its key, including
   * the profile `useProfile` rehydrates from IndexedDB with the `isFollowing`
   * from whenever it was saved, so opening the profile of someone you had just
   * followed wrote that old `false` over your click's `true`.
   *
   * But the gate also shut the door on the fix for the opposite problem. The
   * rehydrated copy (old `storedAt`) folds first and fills the entry, so
   * `needsLookup` turns false and the network profile that arrives a moment
   * later -- `followRequested: true`, or `isFollowing: true` after the request
   * was accepted while the viewer was away -- was never folded in. The button
   * stayed on the saved copy until the entry was cleared.
   *
   * The ordering is by TIME, not by "is there a value yet", and it is safe
   * against the regression above for two independent reasons:
   *   1. A click stamps this account's change clock
   *      (`markFollowGraphChanged`), and `writeServerFollowState` only lets a
   *      payload through if it was generated strictly after that. A profile is
   *      stamped with when its REQUEST STARTED (`_requestedAt`), so the
   *      rehydrated copy (started long ago) loses to the click, and so does a
   *      fetch that began before the tap and resolved after it. A toggle still
   *      in flight is declined outright, and a plain `false` cannot clear
   *      Requested unless it is newer.
   *   2. Without a click, the answer must also have been generated after the
   *      data behind the entry (below), so an older copy never overwrites a
   *      newer reading -- and a copy of what the entry already says is a no-op.
   * The profile query itself is still only ENABLED when the state is unknown
   * (`needsLookup`), so this costs no extra request: the fold just reads
   * whatever profile data the button can see, whoever fetched it.
   */
  const profileState = typeof targetProfile?.isFollowing === 'boolean'
    ? profileFollowState(targetProfile)
    : undefined;
  // When the profile's body was generated: the start of the request that
  // produced it (see stampRequestedAt), not the moment it arrived. An
  // unstamped payload (a seed written by another feature) falls back to its
  // arrival time.
  const profileGeneratedAt = profileRequestedAt(targetProfile) ?? targetProfileUpdatedAt;
  useEffect(() => {
    if (isSelf || profileState === undefined) return;
    // Nothing recorded yet: any profile answer is news. Otherwise the answer
    // must have been generated after the data behind the entry. (Not "after
    // the entry was written": a rehydrated copy writes the entry now with
    // data from an hour ago, and the network answer for the same mount starts
    // before that write.)
    const entryEmpty = !isFollowStateValue(readFollowState(queryClient, cleanTargetUsername));
    const isNewer =
      typeof profileGeneratedAt === 'number'
      && profileGeneratedAt > followEntryGeneratedAt(queryClient, cleanTargetUsername);
    if (!entryEmpty && !isNewer) return;
    writeServerFollowState(queryClient, cleanTargetUsername, profileState, profileGeneratedAt);
  }, [
    queryClient,
    cleanTargetUsername,
    isSelf,
    profileState,
    profileGeneratedAt,
  ]);

  const state = isFollowStateValue(sharedState)
    ? sharedState
    : profileFollowState(targetProfile);
  const entityKey = followEntityKey(cleanTargetUsername);
  // The pending intent (on or off) outranks a render that has not caught up
  // with the latest tap. Which "on" it is comes from the shared entry, which
  // the same tap has already written: Requested stays Requested, anything else
  // is Following.
  const intentOn = toggleRegistry.getLatestIntent(entityKey, isFollowOn(state));
  const displayState = !intentOn ? false : state === FOLLOW_REQUESTED ? FOLLOW_REQUESTED : true;

  const { follow, unfollow } = useFollowMutation(targetUsername);
  // Unfollowing asks first; following never does.
  const [confirmingUnfollow, setConfirmingUnfollow] = useState(false);

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
    
    // The button is showing "Following": this tap would unfollow, so ask first.
    // Nothing is recorded in the toggle registry until it is confirmed - a
    // cancelled question must leave no pending intent behind. "Requested" does
    // not ask: withdrawing a request costs nothing to redo.
    if (displayState === true) {
      setConfirmingUnfollow(true);
      return;
    }
    runToggle();
  };

  const runToggle = () => {
    const nextOn = toggleRegistry.getNextToggleIntent(entityKey, isFollowOn(state));
    if (nextOn) {
      follow();
    } else {
      unfollow();
    }
  };

  const label = displayState === true ? 'Following' : displayState === FOLLOW_REQUESTED ? 'Requested' : 'Follow';
  const stateClass = displayState ? styles.following : styles.notFollowing;

  return (
    <>
    <button
      onClick={handleClick}
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
    {confirmingUnfollow && (
      // The sheet is portalled to <body>, but React events still bubble through
      // the component tree: without this, a tap inside it would also reach the
      // profile card this button sits in and navigate away.
      <div style={{ display: 'contents' }} onClick={(e) => e.stopPropagation()}>
        <UnfollowModal
          username={targetUsername}
          onCancel={() => setConfirmingUnfollow(false)}
          onConfirm={() => {
            setConfirmingUnfollow(false);
            runToggle();
          }}
        />
      </div>
    )}
    </>
  );
};

export default FollowButton;
