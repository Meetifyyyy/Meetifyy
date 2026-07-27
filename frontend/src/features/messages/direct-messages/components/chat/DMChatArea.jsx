import { useChatAreaState } from '@features/messages/shared/hooks/useChatAreaState';
import ChatAreaLayout from '@features/messages/shared/components/ChatAreaLayout';
import DMChatHeader from './DMChatHeader';

export default function DMChatArea({
  conversation,
  onSendMessage,
  onRetryMessage,
  onReactMessage,
  onClearChat,
  onTogglePin,
  onBlockUser,
  onBack,
  showChatOnMobile,
  isLoading,
  hasMore,
  isLoadingMore,
  onLoadMore,
  onMarkSeen,
}) {
  const state = useChatAreaState(conversation);

  const isBlocked = conversation?.isBlocked || conversation?.blocked;

  return (
    <ChatAreaLayout
      {...state}
      conversation={conversation}
      showChatOnMobile={showChatOnMobile}
      isLoading={isLoading}
      hasMore={hasMore}
      isLoadingMore={isLoadingMore}
      onLoadMore={onLoadMore}
      onMarkSeen={onMarkSeen}
      onSendMessage={onSendMessage}
      onRetryMessage={onRetryMessage}
      onBack={onBack}
      emptyIcon="💬"
      emptyLabel="Select a conversation"
      inputDisabled={isBlocked}
      inputDisabledReason={isBlocked ? 'You cannot message this contact' : null}
      header={
        <DMChatHeader
          conversation={conversation}
          onBack={onBack}
          onBlock={onBlockUser}
          onClearChat={onClearChat}
          onTogglePin={onTogglePin}
          onOpenDetails={() => state.setShowDetails(true)}
        />
      }
    />
  );
}
