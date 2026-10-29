import GroupPreview from './GroupPreview';
import styles from './GroupInvitePanel.module.css';
// The panel stands in for the chat pane, so it reuses that pane's container
// rules — including the mobile rule that only shows it once a chat is open.
import chatStyles from './ChatAreaLayout.module.css';

/**
 * What someone not in a group sees at its address (/messages/:slug/:publicId):
 * the group preview, in the chat pane.
 *
 * Both the history endpoint and /details require membership, so without this
 * screen the address resolved to "Chat not found". The address is not an
 * invite, though: it names none, so the preview shows the group (no members'
 * faces) with "Invite link expired" in place of a Join button, and the server
 * refuses a join through it. Addresses shared before invite links existed
 * land here. A member opening it goes straight into the chat instead.
 */
export default function GroupInvitePanel({ groupId, onBack, showChatOnMobile }) {
  return (
    <div className={`${chatStyles.chatArea} ${showChatOnMobile ? chatStyles.chatAreaVisible : ''}`}>
      <div className={styles.panel}>
        <div className={styles.card}>
          <GroupPreview groupId={groupId} />
          <button type="button" className={styles.secondaryBtn} onClick={onBack}>
            Back to Messages
          </button>
        </div>
      </div>
    </div>
  );
}
