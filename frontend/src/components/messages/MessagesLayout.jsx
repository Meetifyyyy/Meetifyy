import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSmartBack } from '../../hooks/useSmartBack';
import { useData } from '../../context/DataContext';
import ConversationList from './ConversationList';
import ChatArea from './ChatArea';
import styles from './MessagesLayout.module.css';

export default function MessagesLayout() {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const { 
    conversations, 
    sendDirectMessage, 
    reactToMessage, 
    clearChat, 
    toggleBlockUser,
    addGroupMember,
    currentUser
  } = useData();

  const initialChatId = conversationId 
    ? (isNaN(conversationId) ? conversationId : Number(conversationId))
    : null;

  const [activeChatId, setActiveChatId] = useState(initialChatId);
  const [showChatOnMobile, setShowChatOnMobile] = useState(!!conversationId);

  useEffect(() => {
    if (conversationId) {
      const id = isNaN(conversationId) ? conversationId : Number(conversationId);
      setActiveChatId(id);
      setShowChatOnMobile(true);
    } else {
      setActiveChatId(null);
      setShowChatOnMobile(false);
    }
  }, [conversationId]);

  const activeConv = conversations.find((c) => {
    if (!c || activeChatId == null) return false;
    const cleanAid = String(activeChatId).replace(/^(act_)+/, '');
    const cleanCid = String(c.id).replace(/^(act_)+/, '');
    const cleanActId = c.activityId ? String(c.activityId).replace(/^(act_)+/, '') : null;
    return cleanCid === cleanAid || cleanActId === cleanAid;
  }) || null;

  const handleSelectChat = (id) => {
    setActiveChatId(id);
    setShowChatOnMobile(true);
    navigate(`/messages/${id}`);
  };

  const goBack = useSmartBack();

  const handleBack = () => {
    goBack('/messages', { replace: true });
  };

  const handleSend = (convId, text, replyTo = null, mentions = [], mediaUrl = null, mediaType = null) => {
    sendDirectMessage(convId, text, replyTo, null, mentions, mediaUrl, mediaType);
  };

  const handleReact = (convId, messageIndex, reaction) => {
    reactToMessage(convId, messageIndex, reaction);
  };

  const handleClearChat = (convId) => {
    clearChat(convId);
  };

  const handleBlockUser = (convId) => {
    toggleBlockUser(convId);
  };

  const handleJoinGroup = (groupId) => {
    addGroupMember(groupId, currentUser?.id);
    // Optionally navigate to the group
    handleSelectChat(groupId);
  };

  return (
    <div className={styles.page}>
      <div className={`${styles.messagesLayout}${showChatOnMobile ? ' show-chat' : ''}`}>
        <ConversationList
          conversations={conversations}
          activeChatId={activeChatId}
          onSelect={handleSelectChat}
          showChatOnMobile={showChatOnMobile}
        />
        <ChatArea
          conversation={activeConv}
          onSendMessage={handleSend}
          onReactMessage={(msgIndex, reaction) => handleReact(activeChatId, msgIndex, reaction)}
          onClearChat={() => handleClearChat(activeChatId)}
          onBlockUser={() => handleBlockUser(activeChatId)}
          onJoinGroup={handleJoinGroup}
          onBack={handleBack}
          showChatOnMobile={showChatOnMobile}
        />
      </div>
    </div>
  );
}
