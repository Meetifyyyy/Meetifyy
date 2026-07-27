import { Suspense, lazy } from 'react';
import { useMediaViewer } from '@shared/context/MediaViewerContext';
import Avatar from '@shared/components/avatar/Avatar';
import ChatMessageList from './ChatMessageList';
import ChatInputArea from './ChatInputArea';
import MessageContextMenu from './MessageContextMenu';
import ChatDetailsPanel from './details/ChatDetailsPanel';
import ConfirmModal from '@shared/components/modals/ConfirmModal';
import styles from './ChatAreaLayout.module.css';

const ForwardMessageModal = lazy(() => import('./modals/ForwardMessageModal'));

export default function ChatAreaLayout({
  conversation,
  currentUser,
  users,
  conversations,
  showChatOnMobile,
  isLoading,
  hasMore,
  isLoadingMore,
  onLoadMore,
  onMarkSeen,
  onSendMessage,
  onRetryMessage,
  onBack,

  typingUsers,
  isTyping,
  handleKeystroke,
  stopTypingNow,

  replyingTo,
  setReplyingTo,
  contextMenuState,
  openContextMenu,
  closeContextMenu,
  unsendConfirmMsg,
  setUnsendConfirmMsg,
  forwardingMsg,
  setForwardingMsg,
  showDetails,
  setShowDetails,
  handleCopyMessage,
  handleUnsend,
  handleDeleteForMe,

  header,
  emptyIcon = '💬',
  emptyLabel = 'Select a conversation',
  inputDisabled = false,
  inputDisabledReason = null,
  extraModals = null,
  onLeaveActivity = null,

  // Whether to show avatar next to typing bubble (groups only)
  showTypingAvatar = false,
}) {
  const { openViewer } = useMediaViewer();

  const messages = conversation?.messages || [];

  // Resolve the first typing user's info for the avatar
  const firstTypingEntry = typingUsers?.size > 0 ? typingUsers.entries().next().value : null;
  const firstTypingUserId = firstTypingEntry?.[0];
  const firstTypingUserName = firstTypingEntry?.[1];
  const typingParticipant = conversation?.participants?.find(
    (p) => String(p.id || p.userId) === String(firstTypingUserId)
  );
  const typingAvatar = typingParticipant?.avatar || typingParticipant?.profileImage || null;
  const typingName = firstTypingUserName || typingParticipant?.name || '';

  if (!conversation) {
    return (
      <div className={`${styles.chatArea} ${showChatOnMobile ? styles.chatAreaVisible : ''}`}>
        <div className={styles.emptyState}>
          <div className={styles.emptyStateIcon}>{emptyIcon}</div>
          <p>{emptyLabel}</p>
        </div>
      </div>
    );
  }

  if (showDetails) {
    return (
      <div className={`${styles.chatArea} ${showChatOnMobile ? styles.chatAreaVisible : ''}`}>
        <ChatDetailsPanel
          conversation={conversation}
          currentUser={currentUser}
          users={users}
          onBack={() => setShowDetails(false)}
          onClose={() => setShowDetails(false)}
          onLeaveActivity={onLeaveActivity}
        />
      </div>
    );
  }

  return (
    <div className={`${styles.chatArea} ${showChatOnMobile ? styles.chatAreaVisible : ''}`}>
      {header}

      <div className={styles.chatBody}>
        {isLoading ? (
          <div className={styles.loadingState}>Loading messages…</div>
        ) : (
          <ChatMessageList
            messages={messages}
            conversation={conversation}
            currentUser={currentUser}
            users={users}
            isTyping={isTyping}
            typingUsers={typingUsers}
            hasMore={hasMore}
            isLoadingMore={isLoadingMore}
            onLoadMore={onLoadMore}
            onContextMenu={openContextMenu}
            onReplyTo={setReplyingTo}
            onRetry={onRetryMessage}
            onOpenMediaModal={(url) => openViewer([{ url }], 0)}
            conversations={conversations}
            onMarkSeen={onMarkSeen}
          />
        )}
      </div>

      <ChatInputArea
        conversation={conversation}
        onSend={onSendMessage}
        onTyping={handleKeystroke}
        stopTypingNow={stopTypingNow}
        replyingTo={replyingTo}
        onCancelReply={() => setReplyingTo(null)}
        disabled={inputDisabled}
        disabledReason={inputDisabledReason}
      />

      {contextMenuState && (
        <MessageContextMenu
          msg={contextMenuState.msg}
          position={{ x: contextMenuState.x, y: contextMenuState.y }}
          currentUser={currentUser}
          onClose={closeContextMenu}
          onReply={() => { setReplyingTo(contextMenuState.msg); closeContextMenu(); }}
          onCopy={() => { handleCopyMessage(contextMenuState.msg); closeContextMenu(); }}
          onUnsend={() => { setUnsendConfirmMsg(contextMenuState.msg); closeContextMenu(); }}
          onDeleteForMe={() => { handleDeleteForMe(contextMenuState.msg); closeContextMenu(); }}
          onForward={() => { setForwardingMsg(contextMenuState.msg); closeContextMenu(); }}
        />
      )}

      {unsendConfirmMsg && (
        <ConfirmModal
          title="Unsend message?"
          description="This will remove the message for everyone."
          confirmLabel="Unsend"
          onConfirm={handleUnsend}
          onCancel={() => setUnsendConfirmMsg(null)}
          isDestructive
        />
      )}

      {forwardingMsg && (
        <Suspense fallback={null}>
          <ForwardMessageModal
            msg={forwardingMsg}
            conversations={conversations}
            onClose={() => setForwardingMsg(null)}
          />
        </Suspense>
      )}

      {extraModals}
    </div>
  );
}
