import { useState, useEffect, Suspense, lazy } from 'react';
import { useAuth } from '@shared/context/AuthContext';
import { useMediaViewer } from '@shared/context/MediaViewerContext';
import { useQueryClient } from '@tanstack/react-query';
import ConfirmModal from '@shared/components/modals/ConfirmModal';
import { toast } from 'sonner';
import { useData } from '@shared/hooks/useData';
import { messagesApi } from '@shared/api/apiClient';

import GroupChatHeader from './GroupChatHeader';
import ChatMessageList from '../../../shared/components/ChatMessageList';
import ChatInputArea from '../../../shared/components/ChatInputArea';
import MessageContextMenu from '../../../shared/components/MessageContextMenu';
import ChatDetailsPanel from '../../../shared/components/details/ChatDetailsPanel';

const ForwardMessageModal = lazy(() => import('../../../shared/components/modals/ForwardMessageModal'));
const GroupSettingsModal = lazy(() => import('../modals/GroupSettingsModal'));

import styles from './GroupChatArea.module.css';

export default function GroupChatArea({
  conversation,
  onSendMessage,
  onRetryMessage,
  onReactMessage,
  onLeaveGroup,
  onBack,
  showChatOnMobile,
  isLoading,
  hasMore,
  isLoadingMore,
  onLoadMore,
}) {
  const queryClient = useQueryClient();
  const { openViewer } = useMediaViewer();
  const { currentUser } = useAuth();
  const { users, conversations } = useData();

  const [replyingTo, setReplyingTo] = useState(null);
  const [contextMenuState, setContextMenuState] = useState(null);
  const [unsendConfirmMsg, setUnsendConfirmMsg] = useState(null);
  const [forwardingMsg, setForwardingMsg] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    setContextMenuState(null);
    setReplyingTo(null);
    setUnsendConfirmMsg(null);
    setForwardingMsg(null);
    setShowSettings(false);
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
  
  const isBanned = conversation?.myMembershipStatus === 'BANNED';
  const isKicked = conversation?.myMembershipStatus === 'KICKED';
  const isPending = conversation?.myMembershipStatus === 'PENDING';
  const isAdmin = String(conversation?.ownerId || conversation?.hostId || conversation?.creatorId) === String(currentUser?.id);

  if (!conversation) {
    return (
      <div className={`${styles.groupChatArea} ${showChatOnMobile ? styles.groupChatAreaVisible : ''}`}>
        <div className={styles.emptyState}>
          <div className={styles.emptyStateIcon}>👥</div>
          <p>Select a conversation</p>
        </div>
      </div>
    );
  }

  if (showDetails) {
    return (
      <div className={`${styles.groupChatArea} ${showChatOnMobile ? styles.groupChatAreaVisible : ''}`}>
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
    <div className={`${styles.groupChatArea} ${showChatOnMobile ? styles.groupChatAreaVisible : ''}`}>
      <GroupChatHeader
        conversation={conversation}
        onBack={onBack}
        onLeaveGroup={onLeaveGroup}
        onOpenDetails={() => setShowDetails(true)}
        onOpenSettings={() => setShowSettings(true)}
        isAdmin={isAdmin}
      />

      <div className={styles.groupChatBody}>
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
          />
        )}
      </div>

      <ChatInputArea
        conversation={conversation}
        onSend={onSendMessage}
        replyingTo={replyingTo}
        onCancelReply={() => setReplyingTo(null)}
        disabled={isBanned || isKicked || isPending}
        disabledReason={
          isBanned ? 'You have been banned from this group'
          : isKicked ? 'You have been removed from this group'
          : isPending ? 'Your join request is pending'
          : null
        }
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

      {showSettings && (
         <Suspense fallback={null}>
           <GroupSettingsModal
             conversation={conversation}
             onClose={() => setShowSettings(false)}
           />
         </Suspense>
      )}
    </div>
  );
}
