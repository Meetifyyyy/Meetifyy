import { useParams, useNavigate } from 'react-router-dom';
import { useData } from '@shared/hooks/useData';
import GroupList from '../components/sidebar/GroupList';
import GroupChatArea from '../components/chat/GroupChatArea';
import styles from './GroupChatsPage.module.css';
import { messagesApi } from '@shared/api/apiClient';

export default function GroupChatsPage() {
  const { param1 } = useParams();
  const navigate = useNavigate();
  const { 
    conversations = [], 
    isConversationsLoading, 
    sendDirectMessage, 
    reactToMessage, 
    leaveGroup,
    createGroupConversation,
    togglePinConversation,
    toggleMuteConversation,
  } = useData();

  // Filter ONLY Groups
  const groupConversations = conversations.filter(c => {
    if (c.isActivityChat || String(c.id).startsWith('act_') || c.activityId) return false;
    if (c.isGroup || String(c.id).startsWith('c_') || c.isCampusGroup) return true;
    return false;
  });

  const activeChatId = param1 || null;
  const activeConv = activeChatId ? groupConversations.find(c => String(c.id) === String(activeChatId) || String(c.publicId) === String(activeChatId)) : null;

  const handleSelect = (id) => navigate(`/messages/groups/${id}`);
  const handleBack = () => navigate('/messages/groups');

  const handleCreateGroup = async (groupName, userIds) => {
    const newConvId = await createGroupConversation(groupName, userIds);
    if (newConvId) handleSelect(newConvId);
  };

  return (
    <div className={styles.container}>
      <div className={`${styles.sidebar} ${activeChatId ? styles.sidebarHiddenMobile : ''}`}>
        <GroupList
          conversations={groupConversations}
          activeChatId={activeChatId}
          onSelect={handleSelect}
          isLoading={isConversationsLoading}
          onMarkRead={(id) => messagesApi.markAsRead(id)}
          onPin={(id) => togglePinConversation(id)}
          onMute={(id) => toggleMuteConversation(id)}
          onLeave={(id) => leaveGroup(id)}
          onCreateGroup={handleCreateGroup}
        />
      </div>
      <div className={`${styles.chatArea} ${!activeChatId ? styles.chatAreaHiddenMobile : ''}`}>
        <GroupChatArea
          conversation={activeConv}
          showChatOnMobile={!!activeChatId}
          onBack={handleBack}
          onSendMessage={sendDirectMessage}
          onReactMessage={reactToMessage}
          onLeaveGroup={leaveGroup}
        />
      </div>
    </div>
  );
}
