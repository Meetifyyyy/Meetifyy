import { useChatAreaState } from '@features/messages/shared/hooks/useChatAreaState';
import ChatAreaLayout from '@features/messages/shared/components/ChatAreaLayout';
import ActivityChatHeader from './ActivityChatHeader';

export default function ActivityChatArea({
  conversation,
  onSendMessage,
  onRetryMessage,
  onReactMessage,
  onEndActivity,
  onLeaveActivity,
  onClearChat,
  onTogglePin,
  onBack,
  showChatOnMobile,
  isLoading,
  hasMore,
  isLoadingMore,
  onLoadMore,
  onMarkSeen,
  hasLeftGroup,
  activityHasStarted,
}) {
  const state = useChatAreaState(conversation);
  const { currentUser } = state;

  const isHost =
    String(conversation?.activity?.hostId || conversation?.hostId) ===
    String(currentUser?.id);

  // User left after activity started → read-only (can view history, cannot send)
  const isReadOnlyAfterLeave = hasLeftGroup && activityHasStarted;

  const inputDisabled = isReadOnlyAfterLeave;
  const inputDisabledReason = isReadOnlyAfterLeave
    ? 'You left this group'
    : null;

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
      onLeaveActivity={onLeaveActivity}
      emptyIcon="🏕️"
      emptyLabel="Select an activity chat"
      showTypingAvatar
      inputDisabled={inputDisabled}
      inputDisabledReason={inputDisabledReason}
      header={
        <ActivityChatHeader
          conversation={conversation}
          onBack={onBack}
          onOpenDetails={() => state.setShowDetails(true)}
          onEndActivity={onEndActivity}
          onLeaveActivity={onLeaveActivity}
          onClearChat={onClearChat}
          onTogglePin={onTogglePin}
          isHost={isHost}
          activityHasStarted={activityHasStarted}
          hasLeftGroup={hasLeftGroup}
        />
      }
    />
  );
}
