import { useChatAreaState } from '@features/messages/shared/hooks/useChatAreaState';
import { useMessagingEligibility } from '@shared/hooks/useMessagingEligibility';
import { resolveComposerState } from '@shared/utils/messagingEligibility';
import ChatAreaLayout from '@features/messages/shared/components/ChatAreaLayout';
import DMChatHeader from './DMChatHeader';

export default function DMChatArea({
  conversation,
  onSendMessage,
  onReactMessage,
  onClearChat,
  onTogglePin,
  onToggleMute,
  onBlockUser,
  onBack,
  onNewMessage,
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

  // Messaging requires BOTH people to be verified. The conversation itself
  // still opens and its history still renders — only the composer is replaced,
  // and it comes back on its own the moment both sides are eligible again.
  const { canSend, reason: unavailableReason } = useMessagingEligibility(conversation);

  // One resolver, shared with the group chat area, so the precedence between a
  // block and a verification lapse cannot drift between the two surfaces.
  const composer = resolveComposerState({
    isBlockedByMe: Boolean(conversation?.isBlockedByMe),
    isBlocked,
    canSend,
    verificationReason: unavailableReason,
  });

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
      onNewMessage={onNewMessage}
      inputDisabled={composer.disabled}
      inputDisabledReason={composer.reason}
      header={
        <DMChatHeader
          conversation={conversation}
          onBack={onBack}
          onBlock={onBlockUser}
          onClearChat={onClearChat}
          onTogglePin={onTogglePin}
          onToggleMute={onToggleMute}
          onToggleSearch={() => {
            if (state.showSearch) {
              state.closeSearch();
            } else {
              state.openSearch();
            }
          }}
          onOpenDetails={() => state.setShowDetails(true)}
        />
      }
    />
  );
}
