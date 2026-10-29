import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Avatar from '@shared/components/avatar/Avatar';
import { getMediaUrl } from '@shared/api/apiClient';
import { showToast } from '@shared/utils/toast';
import { generateConversationUrl } from '@shared/utils/conversationUrl';
import { useAuth } from '@shared/context/AuthContext';
import { OfflineError } from '@shared/lib/offlineGuard';
import {
  useGroupPreview,
  useJoinGroup,
  inviteErrorCode,
  inviteErrorMessage,
  isVerificationRequiredError,
  JOIN_NEEDS_VERIFICATION,
} from '@features/messages/hooks/useGroupInvite';
import styles from './GroupPreview.module.css';

/**
 * A group as an invite shows it: its picture, name, up to five of its
 * members, how many there are, and one button whose label is the server's
 * answer for this person and this invite (`joinState`).
 *
 * The one preview for every way in: a chat's invite card (in a sheet), an
 * invite link (`/g/<code>`, in the same sheet over Messages), and a group's
 * address opened by someone not in it (in the chat pane). It never decides
 * anything itself: an expired invite reads "Invite link expired" because the
 * server said so, and the server refuses that join whatever this shows.
 *
 * `snapshot` is what the invite card already knows (name, picture), drawn
 * while the preview loads so the sheet opens with the group in it rather
 * than a blank shimmer.
 */

const MAX_FACES = 5;

const ACTION = {
  MEMBER: { label: 'Open group', enabled: true },
  CAN_JOIN: { label: 'Join group', enabled: true, busy: 'Joining…' },
  APPROVAL_REQUIRED: {
    label: 'Request to join',
    enabled: true,
    busy: 'Sending request…',
    note: 'An admin reviews requests to join this group.',
  },
  REQUESTED: {
    label: 'Request pending',
    enabled: false,
    note: 'An admin will review your request.',
  },
  REJECTED: { label: 'Request declined', enabled: false },
  INVITE_EXPIRED: {
    label: 'Invite link expired',
    enabled: false,
    note: 'Ask a member for a new invite.',
  },
  INVITE_REVOKED: {
    label: 'Invite link no longer valid',
    enabled: false,
    note: 'Ask a member for a new invite.',
  },
  INVITE_INVALID: {
    label: 'Invite link no longer valid',
    enabled: false,
    note: 'Ask a member for a new invite.',
  },
  CLOSED: {
    label: 'Group ended',
    enabled: false,
    note: 'This group is no longer accepting members.',
  },
  BLOCKED: { label: 'Unavailable', enabled: false, note: "You can't join this group." },
};

/** "in 5 hours", for when a declined person may ask again. */
function askAgainNote(retryAt) {
  const ms = Date.parse(retryAt || '') - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 'You can ask to join again now.';
  const hours = Math.ceil(ms / (60 * 60 * 1000));
  return hours <= 1
    ? 'You can ask to join again in under an hour.'
    : `You can ask to join again in ${hours} hours.`;
}

function memberCountLabel(count) {
  const n = Number(count) || 0;
  return `${n} ${n === 1 ? 'member' : 'members'}`;
}

/** The faces row. Always the same height, so loading in does not move the button. */
function Faces({ members, loading }) {
  if (loading) {
    return (
      <div className={styles.faces} aria-hidden="true">
        {Array.from({ length: 3 }, (_, i) => (
          <span key={i} className={`${styles.face} ${styles.faceSkeleton}`} />
        ))}
      </div>
    );
  }
  if (!members?.length) return <div className={styles.faces} aria-hidden="true" />;
  return (
    <ul className={styles.faces} aria-label="Some of the members">
      {members.slice(0, MAX_FACES).map((m) => (
        <li key={m.id} className={styles.face} title={m.displayName}>
          <Avatar src={m.avatar} name={m.displayName} size="32px" disableHover />
        </li>
      ))}
    </ul>
  );
}

export default function GroupPreview({ groupId, code, messageId, snapshot, onClose, closeLabel = 'Close' }) {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { data: preview, error, refetch, isFetching } = useGroupPreview({ groupId, code, messageId });
  const { join, isPending: isJoining } = useJoinGroup();
  // `isPending` reaches the button a render later: two taps in one frame
  // both saw it false. This is set before the first await.
  const inFlight = useRef(false);

  const invite = code ? { code } : messageId ? { messageId } : null;

  const openGroup = (target) => {
    navigate(generateConversationUrl(target || preview, currentUser?.id, '/messages'), { replace: Boolean(code) });
    onClose?.();
  };

  const handleAction = async () => {
    if (!preview || isJoining || inFlight.current) return;
    if (preview.joinState === 'MEMBER') {
      openGroup();
      return;
    }
    inFlight.current = true;
    try {
      const result = await join(preview.publicId || groupId, preview, invite);
      if (result?.status === JOIN_NEEDS_VERIFICATION) return;
      if (result?.status === 'JOINED') {
        showToast(result.alreadyMember ? 'Already in this group' : `Joined ${preview.name}`, 'success');
        // The preview has the name the address is made from; the result the ids.
        openGroup({ ...preview, ...result });
      } else {
        showToast('Request sent', 'success');
      }
    } catch (err) {
      // The offline guard and the verification prompt have each said why.
      if (err instanceof OfflineError || isVerificationRequiredError(err)) return;
      showToast(inviteErrorMessage(err), 'error');
    } finally {
      inFlight.current = false;
    }
  };

  // ── Before an answer: the card's snapshot, or placeholders, in the same box.
  if (!preview && !error) {
    const name = snapshot?.name;
    const avatar = snapshot?.avatar;
    return (
      <div className={styles.preview} aria-busy="true">
        <Avatar src={avatar ? getMediaUrl(avatar) : null} name={name || ''} size="72px" isGroup isLoading={!name} />
        {name ? (
          <h2 className={styles.name}>{name}</h2>
        ) : (
          <span className={`${styles.nameSkeleton} ${styles.shimmer}`} aria-hidden="true" />
        )}
        <Faces loading />
        <span className={`${styles.countSkeleton} ${styles.shimmer}`} aria-hidden="true" />
        <button type="button" className={styles.primaryBtn} disabled>
          {' '}
        </button>
      </div>
    );
  }

  // ── No group to show: gone, an invalid link, or no connection.
  if (!preview) {
    const errCode = inviteErrorCode(error);
    const gone = errCode === 'GROUP_NOT_FOUND' || errCode === 'FORBIDDEN';
    const badLink = errCode === 'INVITE_INVALID';
    const title = gone
      ? 'This group isn’t available'
      : badLink
        ? 'This invite link isn’t valid'
        : 'Couldn’t load this group';
    const text = gone
      ? 'It may have been deleted.'
      : badLink
        ? 'It may have been reset, or the group no longer exists. Ask a member for a new one.'
        : inviteErrorMessage(error);
    const canRetry = !gone && !badLink;
    return (
      <div className={styles.preview} role="status">
        <Avatar src={null} name="" size="72px" isGroup />
        <h2 className={styles.name}>{title}</h2>
        <p className={styles.note}>{text}</p>
        {canRetry ? (
          <button type="button" className={styles.primaryBtn} onClick={() => refetch()} disabled={isFetching} aria-busy={isFetching || undefined}>
            {isFetching ? 'Retrying…' : 'Try again'}
          </button>
        ) : (
          onClose && (
            <button type="button" className={styles.secondaryBtn} onClick={onClose}>
              {closeLabel}
            </button>
          )
        )}
      </div>
    );
  }

  const action = ACTION[preview.joinState] || ACTION.CAN_JOIN;
  const note = preview.joinState === 'REJECTED' ? askAgainNote(preview.retryAt) : action.note;
  const avatarKey = preview.avatarKey || preview.avatar;

  return (
    <div className={styles.preview}>
      <Avatar src={avatarKey ? getMediaUrl(avatarKey) : null} name={preview.name} size="72px" isGroup />
      <h2 className={styles.name}>{preview.name}</h2>
      <Faces members={preview.memberPreview} />
      <p className={styles.count}>{memberCountLabel(preview.memberCount)}</p>
      <button
        type="button"
        className={styles.primaryBtn}
        onClick={handleAction}
        disabled={!action.enabled || isJoining}
        aria-busy={isJoining || undefined}
      >
        {isJoining && action.busy ? action.busy : action.label}
      </button>
      {note && <p className={styles.note}>{note}</p>}
    </div>
  );
}
