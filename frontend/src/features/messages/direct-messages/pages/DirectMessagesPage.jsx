import { useParams, useNavigate } from 'react-router-dom';
import { useData } from '@shared/hooks/useData';
import DMList from '../components/sidebar/DMList';
import DMChatArea from '../components/chat/DMChatArea';
import styles from './DirectMessagesPage.module.css';
import { messagesApi } from '@shared/api/apiClient';

export default function DirectMessagesPage() {
  const { param1 } = useParams();
  const navigate = useNavigate();
  const { 
    conversations = [], 
    isConversationsLoading, 
    sendDirectMessage, 
    reactToMessage, 
    clearChat, 
    toggleBlockUser,
    startConversation,
    togglePinConversation,
    toggleMuteConversation,
    deleteConversation,
  } = useData();

  // Filter ONLY DMs
  const dmConversations = conversations.filter(c => {
    if (c.isActivityChat || String(c.id).startsWith('act_') || c.activityId) return false;
    if (c.isGroup || String(c.id).startsWith('c_') || c.isCampusGroup) return false;
    return true;
  });

  const activeChatId = param1 || null;
  const activeConv = activeChatId ? dmConversations.find(c => String(c.id) === String(activeChatId) || String(c.publicId) === String(activeChatId)) : null;

  const handleSelect = (id) => navigate(`/messages/${id}`);
  const handleBack = () => navigate('/messages');

  const handleStartChat = async (targetUser) => {
    if (!targetUser) return;
    const newConvId = await startConversation(targetUser);
    if (newConvId) handleSelect(newConvId);
  };

  return (
    <div className={styles.container}>
      <div className={`${styles.sidebar} ${activeChatId ? styles.sidebarHiddenMobile : ''}`}>
        <DMList
          conversations={dmConversations}
          activeChatId={activeChatId}
          onSelect={handleSelect}
          isLoading={isConversationsLoading}
          onMarkRead={(id) => messagesApi.markAsRead(id)}
          onPin={(id) => togglePinConversation(id)}
          onMute={(id) => toggleMuteConversation(id)}
          onDelete={(id) => deleteConversation(id)}
          onStartChat={handleStartChat}
        />
      </div>
      <div className={`${styles.chatArea} ${!activeChatId ? styles.chatAreaHiddenMobile : ''}`}>
        <DMChatArea
          conversation={activeConv}
          showChatOnMobile={!!activeChatId}
          onBack={handleBack}
          onSendMessage={sendDirectMessage}
          onReactMessage={reactToMessage}
          onClearChat={clearChat}
          onBlockUser={toggleBlockUser}
        />
      </div>
    </div>
  );
}
