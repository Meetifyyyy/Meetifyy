import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { groupApi } from '@shared/api/apiClient';
import { useChatAreaState } from '@features/messages/shared/hooks/useChatAreaState';
import ChatAreaLayout from '@features/messages/shared/components/ChatAreaLayout';
import GroupChatHeader from './GroupChatHeader';

export default function GroupChatArea({
  conversation,
  onSendMessage,
  onReactMessage,
  onLeaveGroup,
  onEndGroup,
  onClearChat,
  onTogglePin,
  onToggleMute,
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
  const convId = conversation?.id || conversation?.publicId || conversation?.internalId;
  const isGroup = Boolean(conversation?.type === 'GROUP' || conversation?.isGroup);

  const { data: groupDetails } = useQuery({
    queryKey: ['groupDetails', convId],
    queryFn: () => groupApi.getDetails(convId),
    enabled: Boolean(isGroup && convId && !notFound && conversation?.isMember !== false && conversation?.myMembershipStatus !== 'KICKED'),
    staleTime: 1000 * 15,
  });

  const effectiveConv = useMemo(() => {
    if (!groupDetails) return conversation;
    return {
      ...conversation,
      name: groupDetails.name || conversation?.name,
      avatar: groupDetails.avatar || groupDetails.avatarKey || conversation?.avatarKey || conversation?.avatar,
      avatarKey: groupDetails.avatarKey || groupDetails.avatar || conversation?.avatarKey || conversation?.avatar,
      description: groupDetails.description ?? conversation?.description,
      ownerId: groupDetails.ownerId || conversation?.ownerId,
      // The server's own word on this user's role, so the header can tell an
      // OWNER (who may end the group) from an ADMIN (who may only leave it)
      // without inferring it from id comparisons.
      myRole: groupDetails.myRole ?? conversation?.myRole,
      admins: groupDetails.admins || conversation?.admins || [],
      members: groupDetails.members || conversation?.members || [],
      memberDetails: groupDetails.memberDetails || conversation?.memberDetails || [],
      memberCount: groupDetails.memberCount ?? conversation?.memberCount ?? 0,
      pendingRequests: groupDetails.pendingRequests || conversation?.pendingRequests || [],
      isMember: groupDetails.myRole !== undefined ? true : (conversation?.isMember !== false),
    };
  }, [conversation, groupDetails]);

  const state = useChatAreaState(effectiveConv);
  const { currentUser } = state;

  const isBanned = effectiveConv?.myMembershipStatus === 'BANNED';
  const isKicked = effectiveConv?.myMembershipStatus === 'KICKED' || effectiveConv?.isMember === false;
  const isPending = effectiveConv?.myMembershipStatus === 'PENDING';
  const isAdmin =
    String(effectiveConv?.ownerId || effectiveConv?.hostId || effectiveConv?.creatorId) ===
    String(currentUser?.id) || (effectiveConv?.admins || []).includes(currentUser?.id);

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
      conversation={effectiveConv}
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
      emptyIcon="👥"
      emptyLabel="Select a conversation"
      showTypingAvatar
      inputDisabled={inputDisabled}
      inputDisabledReason={inputDisabledReason}
      header={
        <GroupChatHeader
          conversation={effectiveConv}
          onBack={onBack}
          onLeaveGroup={onLeaveGroup}
          onEndGroup={onEndGroup}
          onClearChat={onClearChat}
          onTogglePin={onTogglePin}
          onToggleMute={onToggleMute}
          onToggleSearch={() => state.setShowSearch(prev => !prev)}
          onOpenDetails={() => state.setShowDetails(true)}
          isAdmin={isAdmin}
        />
      }
    />
  );
}
