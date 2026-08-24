import { useChatAreaState } from '@features/messages/shared/hooks/useChatAreaState';
import ChatAreaLayout from '@features/messages/shared/components/ChatAreaLayout';
import DMChatHeader from './DMChatHeader';

export default function DMChatArea({
  conversation,
  onSendMessage,
  onReactMessage,
  onClearChat,
  onTogglePin,
  onBlockUser,
  onBack,
  showChatOnMobile,
  isLoading,
  notFound,
  hasMore,
  isLoadingMore,
  onLoadMore,
  onMarkSeen,
  onRetryUpload,
  onCancelUpload,
}) {
  const state = useChatAreaState(conversation);

  // Mutual: the composer is disabled whichever side placed the block.
  const isBlocked = Boolean(
    conversation?.isBlockedByMe || conversation?.isBlockedByThem || conversation?.blocked,
  );

  return (
    <ChatAreaLayout
      {...state}
      conversation={conversation}
      showChatOnMobile={showChatOnMobile}
      isLoading={isLoading}
      notFound={notFound}
      hasMore={hasMore}
      isLoadingMore={isLoadingMore}
      onLoadMore={onLoadMore}
      onMarkSeen={onMarkSeen}
      onRetryUpload={onRetryUpload}
      onCancelUpload={onCancelUpload}
      onSendMessage={onSendMessage}
      onBack={onBack}
      emptyIcon="💬"
      emptyLabel="Select a conversation"
      inputDisabled={isBlocked}
      inputDisabledReason={
        conversation?.isBlockedByMe
          ? 'You blocked this user. Unblock them to continue messaging.'
          : isBlocked
            ? 'You can no longer send messages to this user.'
            : null
      }
      header={
        <DMChatHeader
          conversation={conversation}
          onBack={onBack}
          onBlock={onBlockUser}
          onClearChat={onClearChat}
          onTogglePin={onTogglePin}
          onToggleSearch={() => state.setShowSearch(prev => !prev)}
          onOpenDetails={() => state.setShowDetails(true)}
        />
      }
    />
  );
}
