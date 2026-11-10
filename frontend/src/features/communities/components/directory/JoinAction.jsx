import { useAuth } from '@shared/context/AuthContext';
import { isCommunityMember, isCommunityOwner } from '@shared/utils/community';
import { useJoinCommunity, useRequestToJoin } from '../../hooks/useJoinCommunity';
import styles from './JoinAction.module.css';

/**
 * Join control for a community the viewer may not be in.
 *
 * Public: joins immediately (optimistic). Private: sends a request the owner
 * approves, and then reads "Requested" — the server has no way to withdraw
 * one. Leaving is not offered from a list; that lives on the community page,
 * where it is not one stray tap away.
 *
 * `onTile`: set on a community's colour tile, where the control is drawn in the
 * tile's own ink and ground (--tile-deep, --tile-ink) instead of the brand blue.
 */
export default function JoinAction({ community, onTile = false }) {
  const { currentUser } = useAuth();
  const { mutate: toggleJoin } = useJoinCommunity();
  const request = useRequestToJoin();
  // On a community's colour tile (CommunityRow) the button takes the tile's colours.
  const tile = onTile ? styles.onTile : '';

  if (isCommunityOwner(community, currentUser)) {
    return <span className={`${styles.btn} ${styles.settled} ${tile}`}>Owner</span>;
  }
  if (isCommunityMember(community, currentUser)) {
    return <span className={`${styles.btn} ${styles.settled} ${tile}`}>Joined</span>;
  }
  // The cache is the answer once it has one: a declined request (realtime
  // notice) sets `hasPendingRequest: false`, and this button's own success
  // flag, which never resets, kept it reading "Requested" after the decline.
  if (community.hasPendingRequest || (request.isSuccess && community.hasPendingRequest !== false)) {
    return <span className={`${styles.btn} ${styles.settled} ${tile}`}>Requested</span>;
  }

  const handleClick = () => {
    if (community.isPrivate) {
      request.mutate({ communityId: community.id });
    } else {
      toggleJoin({ communityId: community.id, isJoined: true, currentUser });
    }
  };

  return (
    <button
      type="button"
      className={`${styles.btn} ${styles.primary} ${tile}`}
      onClick={handleClick}
      disabled={request.isPending}
      aria-label={`${community.isPrivate ? 'Request to join' : 'Join'} ${community.name}`}
    >
      {community.isPrivate ? (request.isPending ? 'Sending…' : 'Request') : 'Join'}
    </button>
  );
}
