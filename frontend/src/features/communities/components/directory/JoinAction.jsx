import { useAuth } from '@shared/context/AuthContext';
import { isCommunityMember, isCommunityOwner } from '@shared/utils/community';
import { openVerificationModal } from '@shared/stores/verificationModalStore';
import { useJoinCommunity, useRequestToJoin } from '../../hooks/useJoinCommunity';
import styles from './JoinAction.module.css';

/**
 * Join control for a community the viewer may not be in.
 *
 * Public: joins immediately (optimistic). Private: sends a request the owner
 * approves, and then reads "Requested" — the server has no way to withdraw
 * one. Leaving is not offered from a list; that lives on the community page,
 * where it is not one stray tap away.
 */
export default function JoinAction({ community }) {
  const { currentUser } = useAuth();
  const { mutate: toggleJoin } = useJoinCommunity();
  const request = useRequestToJoin();

  if (isCommunityOwner(community, currentUser)) {
    return <span className={`${styles.btn} ${styles.settled}`}>Owner</span>;
  }
  if (isCommunityMember(community, currentUser)) {
    return <span className={`${styles.btn} ${styles.settled}`}>Joined</span>;
  }
  if (community.hasPendingRequest || request.isSuccess) {
    return <span className={`${styles.btn} ${styles.settled}`}>Requested</span>;
  }

  const handleClick = () => {
    if (currentUser?.verificationStatus !== 'VERIFIED') {
      openVerificationModal('Verify your student ID to join communities.');
      return;
    }
    if (community.isPrivate) {
      request.mutate({ communityId: community.id });
    } else {
      toggleJoin({ communityId: community.id, isJoined: true, currentUser });
    }
  };

  return (
    <button
      type="button"
      className={`${styles.btn} ${styles.primary}`}
      onClick={handleClick}
      disabled={request.isPending}
      aria-label={`${community.isPrivate ? 'Request to join' : 'Join'} ${community.name}`}
    >
      {community.isPrivate ? (request.isPending ? 'Sending…' : 'Request') : 'Join'}
    </button>
  );
}
