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

  const handleSend = (convId, text, replyTo = null) => {
    const now = new Date();
    const timeStr = now.getHours() + ':' + (now.getMinutes() < 10 ? '0' : '') + now.getMinutes();

    setConversations((prev) =>
      prev.map((c) =>
        c.id === convId
          ? {
              ...c,
              messages: [
                ...c.messages,
                { from: 'me', text, time: timeStr, replyTo: replyTo ? { text: replyTo.text, from: replyTo.from } : null }
              ],
              lastMsg: text,
              time: 'now',
            }
          : c
      )
    );
  };

  const handleReact = (convId, messageIndex, reaction) => {
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== convId) return c;
        const updatedMessages = c.messages.map((m, idx) => {
          if (idx !== messageIndex) return m;
          const currentReactions = m.reactions || [];
          const exists = currentReactions.includes(reaction);
          const newReactions = exists
            ? currentReactions.filter((r) => r !== reaction)
            : [...currentReactions, reaction];
          return { ...m, reactions: newReactions };
        });
        return { ...c, messages: updatedMessages };
      })
    );
  };

  const handleClearChat = (convId) => {
    setConversations((prev) =>
      prev.map((c) =>
        c.id === convId
          ? { ...c, messages: [], lastMsg: 'Chat cleared', time: 'now' }
          : c
      )
    );
  };

  const handleBlockUser = (convId) => {
    setConversations((prev) =>
      prev.map((c) =>
        c.id === convId
          ? { ...c, blocked: !c.blocked }
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
        <ChatArea
          conversation={activeConv}
          onSendMessage={handleSend}
          onReactMessage={(msgIndex, reaction) => handleReact(activeChatId, msgIndex, reaction)}
          onClearChat={() => handleClearChat(activeChatId)}
          onBlockUser={() => handleBlockUser(activeChatId)}
          onBack={handleBack}
        />
      </div>
    </div>
  );
}

