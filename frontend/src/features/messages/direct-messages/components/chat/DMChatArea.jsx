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
    conversation?.isBlockedByMe ||
    conversation?.isBlockedByThem ||
    conversation?.blocked ||
    // A deleted partner closes the thread for writes the same way a block
    // does; the history stays readable, which is the whole point.
    conversation?.targetUserUnavailable ||
    conversation?.targetUser?.isDeleted,
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
          /*
           * A draft has no conversation row yet, so its id is the synthetic
           * `draft_<userId>` this screen invents to key the route. Pin, mute and
           * clear are conversation-scoped: handed that id they called endpoints
           * that cannot resolve it, failed server-side and silently did
           * nothing, which is what made the header menu look broken until the
           * first message had been sent.
           *
           * They are withheld rather than disabled because there is nothing to
           * act on: an empty draft cannot be pinned, muted or cleared, and the
           * header already renders each item only when its handler exists.
           * Contact Info and Block stay, because both are about the PERSON and
           * work perfectly well before a conversation exists.
           */
          onClearChat={conversation?.isDraft ? undefined : onClearChat}
          onTogglePin={conversation?.isDraft ? undefined : onTogglePin}
          onToggleMute={conversation?.isDraft ? undefined : onToggleMute}
          onToggleSearch={conversation?.isDraft ? undefined : () => {
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
