import { Suspense, lazy } from 'react';
import { Search, X } from 'lucide-react';
import { useMediaViewer } from '@shared/context/MediaViewerContext';
import { useData } from '@shared/hooks/useData';
import { showToast } from '@shared/utils/toast';
import Avatar from '@shared/components/avatar/Avatar';
import ChatMessageList from './ChatMessageList';
import ChatInputArea from './ChatInputArea';
import MessageContextMenu from './MessageContextMenu';
import ChatDetailsPanel from './details/ChatDetailsPanel';
import ConfirmModal from '@shared/components/modals/ConfirmModal';
import NotFoundState from '@shared/components/ui/NotFoundState';
import styles from './ChatAreaLayout.module.css';

const ForwardMessageModal = lazy(() => import('./modals/ForwardMessageModal'));

export default function ChatAreaLayout({
  conversation,
  currentUser,
  users,
  conversations,
  showChatOnMobile,
  isLoading,
  notFound,
  hasMore,
  isLoadingMore,
  onLoadMore,
  onMarkSeen,
  onRetryUpload,
  onCancelUpload,
  onSendMessage,
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
  showSearch,
  setShowSearch,
  searchQuery,
  setSearchQuery,
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
  const { sendDirectMessage } = useData();

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

  if (notFound) {
    return (
      <div className={`${styles.chatArea} ${showChatOnMobile ? styles.chatAreaVisible : ''}`}>
        <NotFoundState type="chat" coverPage={false} onAction={onBack} actionLabel="Back to Messages" />
      </div>
    );
  }

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
          onSearch={() => {
            setShowDetails(false);
            setShowSearch(true);
          }}
          onLeaveActivity={onLeaveActivity}
        />
      </div>
    );
  }

  return (
    <div className={`${styles.chatArea} ${showChatOnMobile ? styles.chatAreaVisible : ''}`}>
      {header}

      {showSearch && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '8px 16px',
          background: 'var(--color-bg-subtle, #18181b)',
          borderBottom: '1px solid var(--color-border, #27272a)',
          zIndex: 5,
        }}>
          <Search size={16} style={{ opacity: 0.6, flexShrink: 0 }} />
          <input
            type="text"
            placeholder="Find in chat..."
            value={searchQuery || ''}
            onChange={(e) => setSearchQuery?.(e.target.value)}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--color-text-main, #ffffff)',
              fontSize: '0.85rem'
            }}
            autoFocus
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery?.('')}
              style={{ background: 'transparent', border: 'none', color: 'var(--color-text-muted, #94a3b8)', cursor: 'pointer', fontSize: '0.8rem', padding: '2px 6px' }}
            >
              Clear
            </button>
          )}
          <button
            onClick={() => { setShowSearch?.(false); setSearchQuery?.(''); }}
            style={{ background: 'transparent', border: 'none', color: 'var(--color-text-muted, #94a3b8)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '2px' }}
          >
            <X size={18} />
          </button>
        </div>
      )}

      <div className={styles.chatBody}>
        <ChatMessageList
          key={conversation?.internalId || conversation?.publicId || conversation?.id || 'chat-list'}
          isLoading={isLoading}
          messages={messages}
          conversation={conversation}
          currentUser={currentUser}
          users={users}
          searchQuery={searchQuery}
          isTyping={isTyping}
          typingUsers={typingUsers}
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          onLoadMore={onLoadMore}
          onContextMenu={openContextMenu}
          onReplyTo={setReplyingTo}
          onOpenMediaModal={(url, type) => openViewer([{ url, type: type || 'image' }], 0)}
          conversations={conversations}
          onMarkSeen={onMarkSeen}
          onRetryUpload={onRetryUpload}
          onCancelUpload={onCancelUpload}
        />
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
          title="Unsend Message"
          desc="This message will be removed for everyone in this chat."
          confirmText="Unsend"
          cancelText="Cancel"
          visible={Boolean(unsendConfirmMsg)}
          onConfirm={handleUnsend}
          onCancel={() => setUnsendConfirmMsg(null)}
          isDestructive={true}
        />
      )}

      {forwardingMsg && (
        <Suspense fallback={null}>
          <ForwardMessageModal
            isOpen={Boolean(forwardingMsg)}
            msg={forwardingMsg}
            conversations={conversations}
            onClose={() => setForwardingMsg(null)}
            onConfirmForward={async (targetIds) => {
              try {
                const text = forwardingMsg.text || forwardingMsg.payload?.text || '';
                const mediaUrl = forwardingMsg.mediaUrl || forwardingMsg.payload?.mediaUrl || null;
                const mediaType = forwardingMsg.mediaType || forwardingMsg.payload?.mediaType || null;
                for (const id of targetIds) {
                  await sendDirectMessage(id, { text, mediaUrl, mediaType });
                }
              } catch (e) {
                // ignore
              } finally {
                setForwardingMsg(null);
              }
            }}
          />
        </Suspense>
      )}

      {extraModals}
    </div>
  );
}
