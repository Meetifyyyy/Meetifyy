import { Suspense, lazy, useCallback, useRef, useEffect } from 'react';
import { MessageSquarePlus, Search, X } from '@shared/components/icons';
import { useMediaViewerActions } from '@shared/context/MediaViewerContext';
import { useMessageActions } from '@shared/hooks/useMessageActions';
import { useRecipientConversations } from '@shared/hooks/useRecipientConversations';
import { showToast } from '@shared/utils/toast';
import Avatar from '@shared/components/avatar/Avatar';
import ChatMessageList from './ChatMessageList';
import ChatInputArea from './ChatInputArea';
import MessageContextMenu from './MessageContextMenu';
import ChatDetailsPanel from './details/ChatDetailsPanel';
import ConfirmModal from '@shared/components/modals/ConfirmModal';
import NotFoundState from '@shared/components/ui/NotFoundState';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';
import styles from './ChatAreaLayout.module.css';

const ForwardMessageModal = lazy(() => import('./modals/ForwardMessageModal'));

export default function ChatAreaLayout({
  conversation,
  currentUser,
  users,
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
  onNewMessage,

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
  openSearch,
  closeSearch,
  handleCopyMessage,
  handleUnsend,
  handleDeleteForMe,

  header,
  emptyIcon = null,
  emptyLabel = 'Your Messages',
  emptyDescription = 'Send private messages or create a group chat with your friends.',
  inputDisabled = false,
  inputDisabledReason = null,
  extraModals = null,
  onLeaveActivity = null,

  // Whether to show avatar next to typing bubble (groups only)
  showTypingAvatar = false,
}) {
  const { openViewer } = useMediaViewerActions();
  const { sendDirectMessage } = useMessageActions();

  /**
   * Recipients for the Forward modal, fetched here rather than accepted as a
   * prop.
   *
   * `conversations` was a prop that NOTHING passed: neither DMChatArea nor
   * GroupChatArea supplied it, and it was forwarded to ChatMessageList, which
   * does not accept it. So the in-chat Forward modal was always handed
   * `undefined`, fell back to its `= []` default, and rendered "No
   * conversations found" every time. The prop is gone; the list is fetched
   * where it is used.
   *
   * Gated on the modal being open, so opening a chat does not pay for a request
   * that most sessions never need. It is the same eligibility-filtered query the
   * Share modals use, so Forward cannot offer a recipient the send would refuse.
   */
  const {
    conversations: forwardTargets,
    isLoading: isLoadingForwardTargets,
  } = useRecipientConversations(Boolean(forwardingMsg));
  const searchInputRef = useRef(null);

  const handleCloseSearch = useCallback(() => {
    if (typeof closeSearch === 'function') {
      closeSearch();
    } else {
      setShowSearch?.(false);
      setSearchQuery?.('');
    }
  }, [closeSearch, setShowSearch, setSearchQuery]);

  const handleOpenSearch = useCallback(() => {
    if (typeof openSearch === 'function') {
      openSearch();
    } else {
      setShowDetails?.(false);
      setShowSearch?.(true);
    }
  }, [openSearch, setShowDetails, setShowSearch]);

  const closeDetails = useCallback(() => setShowDetails?.(false), [setShowDetails]);

  // Use overlay back without pushing synthetic history states to eliminate history racing & flicker
  useOverlayBack(Boolean(showSearch), handleCloseSearch, { pushHistoryState: false });

  // Auto-focus search input whenever search opens
  useEffect(() => {
    if (showSearch) {
      const timer = setTimeout(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }, 30);
      return () => clearTimeout(timer);
    }
  }, [showSearch]);

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
          <div className={styles.emptyStateIcon}>{emptyIcon || <MessageSquarePlus size={36} />}</div>
          <h3 className={styles.emptyStateTitle}>{emptyLabel}</h3>
          {emptyDescription && <p className={styles.emptyStateDesc}>{emptyDescription}</p>}
          {onNewMessage && (
            <button type="button" className={styles.emptyStateBtn} onClick={onNewMessage}>
              <MessageSquarePlus size={18} />
              <span>New Message</span>
            </button>
          )}
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
          onBack={closeDetails}
          onClose={closeDetails}
          onSearch={handleOpenSearch}
          onLeaveActivity={onLeaveActivity}
        />
      </div>
    );
  }

  return (
    <div className={`${styles.chatArea} ${showChatOnMobile ? styles.chatAreaVisible : ''}`}>
      {header}

      {showSearch && (
        <div className={styles.searchBar}>
          <Search size={16} className={styles.searchIcon} />
          <input
            ref={searchInputRef}
            type="text"
            className={styles.searchInput}
            placeholder="Find in chat..."
            value={searchQuery || ''}
            onChange={(e) => setSearchQuery?.(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                handleCloseSearch();
              }
            }}
            aria-label="Find in chat"
            autoFocus
          />
          {searchQuery && (
            <button
              type="button"
              className={styles.searchAction}
              onClick={() => {
                setSearchQuery?.('');
                searchInputRef.current?.focus();
              }}
            >
              Clear
            </button>
          )}
          <button
            type="button"
            className={styles.searchAction}
            onClick={handleCloseSearch}
            aria-label="Close search"
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
            conversations={forwardTargets}
            isLoading={isLoadingForwardTargets}
            onClose={() => setForwardingMsg(null)}
            onConfirmForward={async (targetIds) => {
              const text = forwardingMsg.text || forwardingMsg.payload?.text || '';
              const mediaUrl = forwardingMsg.mediaUrl || forwardingMsg.payload?.mediaUrl || null;
              const mediaType = forwardingMsg.mediaType || forwardingMsg.payload?.mediaType || null;

              // Every target is attempted even after one fails, so a single bad
              // recipient does not silently cancel the rest of the selection.
              const failed = [];
              for (const id of targetIds) {
                try {
                  await sendDirectMessage(id, { text, mediaUrl, mediaType });
                } catch {
                  failed.push(id);
                }
              }

              if (failed.length === 0) return;

              /*
               * This used to be `catch (e) { // ignore }` with an unconditional
               * close in `finally`, so a forward that sent nothing at all looked
               * exactly like one that worked: the modal closed and no message
               * appeared anywhere. Partial failures were invisible too.
               *
               * Throwing keeps the modal open with the selection intact, which
               * is what lets the person retry the ones that did not go.
               */
              const sent = targetIds.length - failed.length;
              showToast(
                sent > 0
                  ? `Forwarded to ${sent} of ${targetIds.length} chats`
                  : 'Could not forward the message',
                'error',
              );
              throw new Error(`forward failed for ${failed.length} recipient(s)`);
            }}
          />
        </Suspense>
      )}

      {extraModals}
    </div>
  );
}
