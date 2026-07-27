import { useState, useEffect, Suspense, lazy } from 'react';
import { useAuth } from '@shared/context/AuthContext';
import { useMediaViewer } from '@shared/context/MediaViewerContext';
import { useQueryClient } from '@tanstack/react-query';
import ConfirmModal from '@shared/components/modals/ConfirmModal';
import { toast } from 'sonner';
import { useData } from '@shared/hooks/useData';
import { messagesApi } from '@shared/api/apiClient';
import { useTypingIndicator } from '../../../shared/hooks/useTypingIndicator';

import DMChatHeader from './DMChatHeader';
import ChatMessageList from '../../../shared/components/ChatMessageList';
import ChatInputArea from '../../../shared/components/ChatInputArea';
import MessageContextMenu from '../../../shared/components/MessageContextMenu';
import ChatDetailsPanel from '../../../shared/components/details/ChatDetailsPanel';

const ForwardMessageModal = lazy(() => import('../../../shared/components/modals/ForwardMessageModal'));

import styles from './DMChatArea.module.css';

export default function DMChatArea({
  conversation,
  onSendMessage,
  onRetryMessage,
  onReactMessage,
  onClearChat,
  onBlockUser,
  onBack,
  showChatOnMobile,
  isLoading,
  hasMore,
  isLoadingMore,
  onLoadMore,
  onMarkSeen,
}) {
  const queryClient = useQueryClient();
  const { openViewer } = useMediaViewer();
  const { currentUser } = useAuth();
  const { users, conversations } = useData();

  const [replyingTo, setReplyingTo] = useState(null);
  const [contextMenuState, setContextMenuState] = useState(null);
  const [unsendConfirmMsg, setUnsendConfirmMsg] = useState(null);
  const [forwardingMsg, setForwardingMsg] = useState(null);
  const [showDetails, setShowDetails] = useState(false);

  const { typingUsers, handleKeystroke, stopTypingNow } = useTypingIndicator(conversation?.id, currentUser?.id);

  useEffect(() => {
    setContextMenuState(null);
    setReplyingTo(null);
    setUnsendConfirmMsg(null);
    setForwardingMsg(null);
    setShowDetails(false);
  }, [conversation?.id]);

  const handleCopyMessage = (msg) => {
    if (msg?.text) {
      navigator.clipboard.writeText(msg.text);
      toast.success('Copied');
    }
  };

  const handleUnsend = async () => {
    if (!unsendConfirmMsg) return;
    try {
      await messagesApi.unsendMessage(unsendConfirmMsg.id);
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    } catch {
      toast.error('Could not unsend');
    } finally {
      setUnsendConfirmMsg(null);
    }
  };

  const handleDeleteForMe = async (msg) => {
    try {
      await messagesApi.deleteMessageForMe(msg.id);
      queryClient.setQueryData(['messages', conversation?.id], (old) => {
        if (!old) return old;
        return { ...old, messages: (old.messages || []).filter(m => m.id !== msg.id) };
      });
    } catch {
      toast.error('Could not delete');
    }
  };

  const messages = conversation?.messages || [];
  const isBlocked = conversation?.isBlocked || conversation?.blocked;

  if (!conversation) {
    return (
      <div className={`${styles.dmChatArea} ${showChatOnMobile ? styles.dmChatAreaVisible : ''}`}>
        <div className={styles.emptyState}>
          <div className={styles.emptyStateIcon}>💬</div>
          <p>Select a conversation</p>
        </div>
      </div>
    );
  }

  if (showDetails) {
    return (
      <div className={`${styles.dmChatArea} ${showChatOnMobile ? styles.dmChatAreaVisible : ''}`}>
        <ChatDetailsPanel
          conversation={conversation}
          currentUser={currentUser}
          users={users}
          onBack={() => setShowDetails(false)}
          onClose={() => setShowDetails(false)}
        />
      </div>
    );
  }

  return (
    <div className={`${styles.dmChatArea} ${showChatOnMobile ? styles.dmChatAreaVisible : ''}`}>
      <DMChatHeader
        conversation={conversation}
        onBack={onBack}
        onBlock={onBlockUser}
        onClearChat={onClearChat}
        onOpenDetails={() => setShowDetails(true)}
      />

      <div className={styles.dmChatBody}>
        {isLoading ? (
          <div className={styles.loadingState}>Loading messages…</div>
        ) : (
          <ChatMessageList
            messages={messages}
            conversation={conversation}
            currentUser={currentUser}
            hasMore={hasMore}
            isLoadingMore={isLoadingMore}
            onLoadMore={onLoadMore}
            onContextMenu={(e, msg) => setContextMenuState({ msg, x: e.clientX, y: e.clientY })}
            onReplyTo={setReplyingTo}
            onRetry={onRetryMessage}
            onOpenMediaModal={(url) => openViewer([{ url }], 0)}
            conversations={conversations}
            typingUsers={typingUsers}
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
        disabled={isBlocked}
        disabledReason={isBlocked ? 'You cannot message this contact' : null}
      />

      {contextMenuState && (
        <MessageContextMenu
          msg={contextMenuState.msg}
          position={{ x: contextMenuState.x, y: contextMenuState.y }}
          currentUser={currentUser}
          onClose={() => setContextMenuState(null)}
          onReply={() => { setReplyingTo(contextMenuState.msg); setContextMenuState(null); }}
          onCopy={() => { handleCopyMessage(contextMenuState.msg); setContextMenuState(null); }}
          onUnsend={() => { setUnsendConfirmMsg(contextMenuState.msg); setContextMenuState(null); }}
          onDeleteForMe={() => { handleDeleteForMe(contextMenuState.msg); setContextMenuState(null); }}
          onForward={() => { setForwardingMsg(contextMenuState.msg); setContextMenuState(null); }}
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
    </div>
  );
}
