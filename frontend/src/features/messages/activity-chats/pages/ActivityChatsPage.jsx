import { useParams, useNavigate } from 'react-router-dom';
import { useData } from '@shared/hooks/useData';
import ActivityChatList from '../components/sidebar/ActivityChatList';
import ActivityChatArea from '../components/chat/ActivityChatArea';
import styles from './ActivityChatsPage.module.css';
import { messagesApi } from '@shared/api/apiClient';

export default function ActivityChatsPage() {
  const { param1 } = useParams();
  const navigate = useNavigate();
  const { 
    conversations = [], 
    isConversationsLoading, 
    sendDirectMessage, 
    reactToMessage, 
    endCrewActivity,
    togglePinConversation,
    toggleMuteConversation,
  } = useData();

  // Filter ONLY Activities
  const activityConversations = conversations.filter(c => {
    return !!(c.isActivityChat || String(c.id).startsWith('act_') || c.activityId);
  });

  const activeChatId = param1 || null;
  const activeConv = activeChatId ? activityConversations.find(c => String(c.id) === String(activeChatId) || String(c.publicId) === String(activeChatId) || String(c.activityId) === String(activeChatId)) : null;

  const handleSelect = (id) => navigate(`/messages/activities/${id}`);
  const handleBack = () => navigate('/messages/activities');

  return (
    <div className={styles.container}>
      <div className={`${styles.sidebar} ${activeChatId ? styles.sidebarHiddenMobile : ''}`}>
        <ActivityChatList
          conversations={activityConversations}
          activeChatId={activeChatId}
          onSelect={handleSelect}
          isLoading={isConversationsLoading}
          onMarkRead={(id) => messagesApi.markAsRead(id)}
          onPin={(id) => togglePinConversation(id)}
          onMute={(id) => toggleMuteConversation(id)}
        />
      </div>
      <div className={`${styles.chatArea} ${!activeChatId ? styles.chatAreaHiddenMobile : ''}`}>
        <ActivityChatArea
          conversation={activeConv}
          showChatOnMobile={!!activeChatId}
          onBack={handleBack}
          onSendMessage={sendDirectMessage}
          onReactMessage={reactToMessage}
          onEndActivity={endCrewActivity}
        />
      </div>
    </div>
  );
}
