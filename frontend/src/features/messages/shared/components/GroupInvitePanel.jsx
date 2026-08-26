import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import Avatar from '@shared/components/avatar/Avatar';
import NotFoundState from '@shared/components/ui/NotFoundState';
import { getMediaUrl } from '@shared/api/apiClient';
import { generateConversationUrl } from '@shared/utils/conversationUrl';
import { useAuth } from '@shared/context/AuthContext';
import {
  useGroupInvitePreview,
  useJoinGroup,
  inviteErrorCode,
  inviteErrorMessage,
} from '@features/messages/hooks/useGroupInvite';
import styles from './GroupInvitePanel.module.css';
// The panel stands in for the chat pane, so it reuses that pane's container
// rules — including the mobile rule that only shows it once a chat is open.
import chatStyles from './ChatAreaLayout.module.css';

/**
 * Landing screen for an invite LINK — the case where someone opens
 * /messages/:slug/:publicId for a group they are not in.
 *
 * Both the history endpoint and /details require membership, so without this
 * screen a shared invite link resolved to "Chat not found" and there was no way
 * to accept it. The invite preview endpoint is readable by non-members, which
 * is what lets this render.
 */
export default function GroupInvitePanel({ groupId, onBack, showChatOnMobile }) {
  const navigate = useNavigate();
  const { currentUser } = useAuth();

  const { data: preview, isLoading, error, refetch, isFetching } = useGroupInvitePreview(groupId);
  const { join, isPending: isJoining } = useJoinGroup();

  const Pane = ({ children }) => (
    <div className={`${chatStyles.chatArea} ${showChatOnMobile ? chatStyles.chatAreaVisible : ''}`}>
      <div className={styles.panel}>{children}</div>
    </div>
  );

  if (isLoading) {
    return (
      <Pane>
        <div className={styles.card} aria-busy="true">
          <div className={`${styles.skeletonAvatar} ${styles.shimmer}`} />
          <div className={`${styles.skeletonLine} ${styles.shimmer}`} />
          <div className={`${styles.skeletonLineShort} ${styles.shimmer}`} />
        </div>
      </Pane>
    );
  }

  if (error) {
    const code = inviteErrorCode(error);

    // A group that is gone (or an id that was never a group at all) is the
    // ordinary not-found case and should look like every other one.
    if (code === 'GROUP_NOT_FOUND' || code === 'FORBIDDEN') {
      return (
        <Pane>
          <NotFoundState type="chat" coverPage={false} onAction={onBack} actionLabel="Back to Messages" />
        </Pane>
      );
    }

    // Everything else is transient — offer a retry rather than declaring the
    // invite dead over a dropped connection.
    return (
      <Pane>
        <div className={styles.card}>
          <h2 className={styles.title}>Couldn&apos;t load this invite</h2>
          <p className={styles.subtitle}>{inviteErrorMessage(error)}</p>
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={() => refetch()}
            disabled={isFetching}
          >
            {isFetching ? 'Retrying…' : 'Try again'}
          </button>
          <button type="button" className={styles.secondaryBtn} onClick={onBack}>
            Back to Messages
          </button>
        </div>
      </Pane>
    );
  }

  const openGroup = (target) => {
    navigate(generateConversationUrl(target || preview, currentUser?.id, '/messages'), { replace: true });
  };

  const handleJoin = async () => {
    try {
      const result = await join(groupId);
      if (result?.status === 'JOINED') {
        toast.success(result.alreadyMember ? 'Already joined' : `Joined ${preview.name}`);
        openGroup(result);
      } else {
        toast.success('Join request sent');
        refetch();
      }
    } catch (err) {
      toast.error(inviteErrorMessage(err));
      // A join that failed because the state moved on (group closed, user
      // blocked) should leave the panel showing the new truth.
      refetch();
    }
  };

  const { headline, action, disabled } = (() => {
    switch (preview.joinState) {
      case 'MEMBER':
        return { headline: "You're already in this group.", action: 'Open Group', disabled: false };
      case 'CLOSED':
        return { headline: 'This group has ended and is no longer accepting members.', action: null, disabled: true };
      case 'BLOCKED':
        return { headline: "You can't join this group.", action: null, disabled: true };
      case 'REQUESTED':
        return { headline: 'Your request is waiting for an admin to approve it.', action: 'Requested', disabled: true };
      case 'APPROVAL_REQUIRED':
        return { headline: 'This group requires approval to join.', action: 'Request to Join', disabled: false };
      default:
        return { headline: "You've been invited to join this group.", action: 'Join Group', disabled: false };
    }
  })();

  const isMember = preview.joinState === 'MEMBER';
  const avatarSrc = preview.avatarKey || preview.avatar;

  return (
    <Pane>
      <div className={styles.card}>
        <Avatar src={avatarSrc ? getMediaUrl(avatarSrc) : null} name={preview.name} size="80px" isGroup />
        <h2 className={styles.title}>{preview.name}</h2>
        <p className={styles.meta}>
          {preview.memberCount} {preview.memberCount === 1 ? 'member' : 'members'}
        </p>
        {preview.description && <p className={styles.description}>{preview.description}</p>}
        <p className={styles.subtitle}>{headline}</p>

        {action && (
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={isMember ? () => openGroup() : handleJoin}
            disabled={disabled || isJoining}
            aria-busy={isJoining || undefined}
          >
            {isJoining ? 'Joining…' : action}
          </button>
        )}
        <button type="button" className={styles.secondaryBtn} onClick={onBack}>
          Back to Messages
        </button>
      </div>
    </Pane>
  );
}
