import { useNavigate } from 'react-router-dom';
import { SystemMessageContent } from './MessageBubble';
import styles from './ChatMessageList.module.css';

/**
 * "@name has requested to join the group", in the group's timeline, for its
 * owner and admins only.
 *
 * It looks like a system line but is not a message: it is one of the group's
 * requests to join (GET /join-requests/activity, which the server answers
 * for reviewers alone), merged into the timeline as it is drawn. So it never
 * reaches a member through the history, the chat list's preview, an unread
 * count, a read receipt, search, a push or this device's message cache, and
 * it says on it who can see it.
 */
const STATUS_LABEL = { APPROVED: 'Approved', REJECTED: 'Declined' };

export default function AdminJoinRequestLine({ item, onReview }) {
  const navigate = useNavigate();
  const username = item?.user?.username;
  const text = username
    ? `@${username} has requested to join the group`
    : `${item?.user?.displayName || 'Someone'} has requested to join the group`;
  const answered = STATUS_LABEL[item?.status];
  return (
    <div className={`${styles.systemMessageContainer} ${styles.adminLine}`} data-admin-only="true">
      <div className={styles.systemMessageText}>
        <SystemMessageContent text={text} navigate={navigate} />
        {answered ? (
          <span className={styles.adminLineStatus}>· {answered}</span>
        ) : (
          onReview && (
            <button type="button" className={styles.adminLineAction} onClick={onReview}>
              Review
            </button>
          )
        )}
      </div>
      <span className={styles.adminLineHint}>Only admins can see this</span>
    </div>
  );
}
