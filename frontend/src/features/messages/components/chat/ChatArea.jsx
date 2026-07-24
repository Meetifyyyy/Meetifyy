import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '@shared/context/AuthContext';

import { useMediaViewer } from '@shared/context/MediaViewerContext';

import ConfirmModal from '@shared/components/modals/ConfirmModal';
import GroupSettingsModal from '../modals/GroupSettingsModal';
import ActivityChatDetailsModal from '../modals/ActivityChatDetailsModal';

import ChatHeader from './ChatHeader';
import ChatInputArea from './ChatInputArea';
import ChatMessageList from './ChatMessageList';
import ChatDetailsPanel from '../details/ChatDetailsPanel';

import styles from './ChatArea.module.css';
import { useData } from '@shared/hooks/useData';
import { messagesApi } from '@shared/api/apiClient';
import { toast } from 'sonner';


export default function ChatArea({ 
  conversation, 
  onSendMessage, 
  onRetryMessage,
  onReactMessage, 
  onClearChat, 
  onBlockUser, 
  onJoinGroup, 
  onBack, 
  showChatOnMobile 
}) {
  const { openViewer } = useMediaViewer();
  const { initial, currentUser } = useAuth();
  const { users, crewActivities, endCrewActivity, leaveGroup, toggleMuteConversation } = useData();

  const conversationActivity = useMemo(() => {
    if (!conversation?.isActivityChat || !conversation?.activityId) return null;
    return crewActivities?.find(act => String(act.id) === String(conversation.activityId) || `act_${act.id}` === String(conversation.id) || String(act.id) === String(conversation.id));
  }, [conversation, crewActivities]);

  const isLoading = false;
  const error = null;
  const loadedMessages = conversation?.messages || [];
  const retry = () => {};

  const [replyingTo, setReplyingTo] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchBar, setShowSearchBar] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [unsendingId, setUnsendingId] = useState(null);

  const handleUnsend = useCallback(async (msgId) => {
    if (unsendingId) return;
    setUnsendingId(msgId);
    try {
      await messagesApi.unsendMessage(msgId);
      // Message will be removed via socket event (message:deleted) from the server.
      // As a local fallback: remove optimistically from the in-memory list.
      if (conversation?.messages) {
        const idx = conversation.messages.findIndex(m => m.id === msgId);
        if (idx !== -1) conversation.messages.splice(idx, 1);
      }
    } catch (err) {
      toast.error('Could not unsend.');
    } finally {
      setUnsendingId(null);
    }
  }, [conversation, unsendingId]);
  
  // Mute state is sourced from the conversation (backend-persisted)
  const isMutedNotifications = conversation?.muted || false;
  const setIsMutedNotifications = () => {
    if (conversation?.id) toggleMuteConversation(conversation.id, isMutedNotifications);
  };
  const [showGroupSettings, setShowGroupSettings] = useState(false);
  const [showActivityDetails, setShowActivityDetails] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [showEndConfirm, setShowEndConfirm] = useState(false);

  useEffect(() => {
    setShowDetails(false);
  }, [conversation?.id]);

  const currentActivity = useMemo(() => {
    if (!conversation?.isActivityChat || !conversation?.activityId) return null;
    return crewActivities?.find(a => a.id === conversation.activityId);
  }, [conversation, crewActivities]);

  const isActivityHost = currentActivity?.hostId === currentUser?.id;

  const handleEndActivityFromChat = () => {
    setShowEndConfirm(true);
  };

  const confirmEndActivityFromChat = async () => {
    setShowEndConfirm(false);
    if (currentActivity) {
      await endCrewActivity(currentActivity.id);
      if (onBack) onBack();
    }
  };

  if (!conversation) {
    return (
      <div className={`${styles.msgChatArea} ${styles.msgNoChatSelected}${!showChatOnMobile ? ` ${styles.hideOnMobile}` : ''}`}>
        <div className={styles.msgNoChatContent}>
          <div className={styles.msgNoChatIcon}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
          </div>
          <h3>Your Messages</h3>
          <p>Select a conversation from the list to start chatting, or start a new one.</p>
        </div>
      </div>
    );
  }

  if (showDetails) {
    return (
      <div className={`${styles.msgChatArea}${!showChatOnMobile ? ` ${styles.hideOnMobile}` : ''}`}>
        <ChatDetailsPanel
          conversation={conversation}
          onBack={() => setShowDetails(false)}
          onBlockUser={onBlockUser}
          onClearChat={onClearChat}
          onSearch={() => {
            setShowDetails(false);
            setShowSearchBar(true);
          }}
        />
      </div>
    );
  }

  return (
    <div className={`${styles.msgChatArea}${!showChatOnMobile ? ` ${styles.hideOnMobile}` : ''}`}>
      <ChatHeader 
        conversation={conversation}
        currentUser={currentUser}
        users={users}
        initial={initial}
        onBack={onBack}
        showSearchBar={showSearchBar}
        onToggleSearch={() => setShowSearchBar(!showSearchBar)}
        isMutedNotifications={isMutedNotifications}
        setIsMutedNotifications={setIsMutedNotifications}
        setShowDetails={setShowDetails}
        isActivityHost={isActivityHost}
        handleEndActivityFromChat={handleEndActivityFromChat}
        onClearChat={onClearChat}
        onBlockUser={onBlockUser}
      />

      {showSearchBar && (
        <div className={styles.msgSearchBar}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input 
            type="text" 
            placeholder="Search messages..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={styles.msgSearchBarInput}
            autoFocus
          />
          <button 
            className={styles.msgSearchBarClose} 
            onClick={() => { setShowSearchBar(false); setSearchQuery(''); }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      <ChatMessageList
        isLoading={isLoading}
        error={error}
        retry={retry}
        loadedMessages={loadedMessages}
        conversation={conversation}
        currentUser={currentUser}
        users={users}
        initial={initial}
        searchQuery={searchQuery}
        openViewer={openViewer}
        onReply={setReplyingTo}
        onRetryMessage={onRetryMessage}
        onUnsend={handleUnsend}
        isTyping={isTyping}
        replyingTo={replyingTo}
      />

      <ChatInputArea 
        conversation={conversation}
        currentUser={currentUser}
        onSendMessage={onSendMessage}
        replyingTo={replyingTo}
        onCancelReply={() => setReplyingTo(null)}
        setIsTyping={setIsTyping}
        onJoinGroup={onJoinGroup}
        onBlockUser={onBlockUser}
        showToast={(msg) => toast(msg)}
      />

      <ConfirmModal
        title="End Activity"
        desc="Are you sure you want to end this activity? This will also delete the group chat."
        visible={showEndConfirm}
        onCancel={() => setShowEndConfirm(false)}
        onConfirm={confirmEndActivityFromChat}
        confirmText="End Activity"
      />

      {showGroupSettings && (
        <GroupSettingsModal
          conversation={conversation}
          onClose={() => setShowGroupSettings(false)}
          onLeaveGroup={() => {
            if (leaveGroup) leaveGroup(conversation.id);
            setShowGroupSettings(false);
            if (onBack) onBack();
          }}
        />
      )}

      {showActivityDetails && (
        <ActivityChatDetailsModal 
          conversation={conversation} 
          onClose={() => setShowActivityDetails(false)} 
          onEndActivity={() => {
            setShowActivityDetails(false);
            if (onBack) onBack();
          }}
        />
      )}
    </div>
  );
}
