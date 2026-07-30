import { Suspense, lazy, useState } from 'react';
import { useChatAreaState } from '@features/messages/shared/hooks/useChatAreaState';
import ChatAreaLayout from '@features/messages/shared/components/ChatAreaLayout';
import GroupChatHeader from './GroupChatHeader';

const GroupSettingsModal = lazy(() => import('../modals/GroupSettingsModal'));


export default function GroupChatArea({
  conversation,
  onSendMessage,
  onReactMessage,
  onLeaveGroup,
  onEndGroup,
  onClearChat,
  onTogglePin,
  onBack,
  showChatOnMobile,
  isLoading,
  hasMore,
  isLoadingMore,
  onLoadMore,
  onMarkSeen,
}) {
  const state = useChatAreaState(conversation);
  const { currentUser } = state;
  const [showSettings, setShowSettings] = useState(false);

  const isBanned = conversation?.myMembershipStatus === 'BANNED';
  const isKicked = conversation?.myMembershipStatus === 'KICKED';
  const isPending = conversation?.myMembershipStatus === 'PENDING';
  const isAdmin =
    String(conversation?.ownerId || conversation?.hostId || conversation?.creatorId) ===
    String(currentUser?.id);

  const inputDisabled = isBanned || isKicked || isPending;
  const inputDisabledReason = isBanned
    ? 'You have been banned from this group'
    : isKicked
    ? 'You have been removed from this group'
    : isPending
    ? 'Your join request is pending'
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
      onBack={onBack}
      emptyIcon="👥"
      emptyLabel="Select a conversation"
      showTypingAvatar
      inputDisabled={inputDisabled}
      inputDisabledReason={inputDisabledReason}
      header={
        <GroupChatHeader
          conversation={conversation}
          onBack={onBack}
          onLeaveGroup={onLeaveGroup}
          onEndGroup={onEndGroup}
          onClearChat={onClearChat}
          onTogglePin={onTogglePin}
          onOpenDetails={() => state.setShowDetails(true)}
          onOpenSettings={() => setShowSettings(true)}
          isAdmin={isAdmin}
        />
      }
      extraModals={
        showSettings && (
          <Suspense fallback={null}>
            <GroupSettingsModal
              conversation={conversation}
              onClose={() => setShowSettings(false)}
            />
          </Suspense>
        )
      }
    />
  );
}
