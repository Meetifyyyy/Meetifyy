import { useState } from 'react';
import { initialMessages } from '../../data/messages';
import ConversationList from './ConversationList';
import ChatArea from './ChatArea';

export default function MessagesLayout() {
  const [conversations, setConversations] = useState(initialMessages);
  const [activeChatId, setActiveChatId] = useState(initialMessages[0]?.id || null);
  const [showChatOnMobile, setShowChatOnMobile] = useState(false);

  const activeConv = conversations.find((c) => c.id === activeChatId) || null;

  const handleSelectChat = (id) => {
    setActiveChatId(id);
    setShowChatOnMobile(true);
  };

  const handleBack = () => {
    setShowChatOnMobile(false);
  };

  const handleSend = (convId, text) => {
    const now = new Date();
    const timeStr = now.getHours() + ':' + (now.getMinutes() < 10 ? '0' : '') + now.getMinutes();

    setConversations((prev) =>
      prev.map((c) =>
        c.id === convId
          ? {
              ...c,
              messages: [...c.messages, { from: 'me', text, time: timeStr }],
              lastMsg: text,
              time: 'now',
            }
          : c
      )
    );
  };

  return (
    <div className="feed feed--messages">
      <div className={`messages-layout${showChatOnMobile ? ' show-chat' : ''}`}>
        <ConversationList
          conversations={conversations}
          activeChatId={activeChatId}
          onSelect={handleSelectChat}
        />
        <ChatArea conversation={activeConv} onSendMessage={handleSend} onBack={handleBack} />
      </div>
    </div>
  );
}
