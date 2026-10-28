import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { groupApi } from '@shared/api/apiClient';
import { useChatAreaState } from '@features/messages/shared/hooks/useChatAreaState';
import { useMessagingEligibility } from '@shared/hooks/useMessagingEligibility';
import { resolveComposerState } from '@shared/utils/messagingEligibility';
import ChatAreaLayout from '@features/messages/shared/components/ChatAreaLayout';
import { useClearChatConfirm } from '@features/messages/shared/components/modals/ClearChatModal';
import GroupChatHeader from './GroupChatHeader';

export default function GroupChatArea({
  conversation,
  onSendMessage,
  onReactMessage,
  onLeaveGroup,
  onEndGroup,
  onClearChat,
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
  onRetrySend,
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
      // Membership is the conversation's own statement (list row or history,
      // whichever is newer — see MessagesLayout), never inferred from the
      // details having a role. Those details are a cached copy, and treating
      // "has a role" as "is a member" is what kept a removed user's composer
      // open: the query stops fetching once they are out, but kept its data.
      isMember: conversation?.isMember !== false,
    };
  }, [conversation, groupDetails]);

  const state = useChatAreaState(effectiveConv);
  const { currentUser } = state;
  // Clearing is confirmed first (ClearChatModal); the menus open the dialog.
  const clearChat = useClearChatConfirm(effectiveConv, onClearChat);

  const isBanned = effectiveConv?.myMembershipStatus === 'BANNED';
  // Out of the group: removed by an admin, left by choice, or (when this device
  // only knows the server's `isMember: false`) one of the two.
  const isKicked = effectiveConv?.myMembershipStatus === 'KICKED';
  const hasLeft = effectiveConv?.myMembershipStatus === 'LEFT';
  const isOut = isKicked || hasLeft || effectiveConv?.isMember === false;
  const isPending = effectiveConv?.myMembershipStatus === 'PENDING';
  const isAdmin =
    String(effectiveConv?.ownerId || effectiveConv?.hostId || effectiveConv?.creatorId) ===
    String(currentUser?.id) || (effectiveConv?.admins || []).includes(currentUser?.id);

  // A group is gated on the sender only — one member losing verification must
  // not silence the group for everyone else. Membership problems keep their own
  // more specific wording and are checked first.
  const { canSend, reason: verificationReason } = useMessagingEligibility(effectiveConv);

  const { disabled: inputDisabled, reason: inputDisabledReason } =
    resolveComposerState({
      membershipReason: isBanned
        ? 'You have been banned from this group'
        : isOut
          ? (isKicked
            ? 'You have been removed from this group'
            : hasLeft
              ? 'You left this group'
              : "You're no longer in this group")
          : isPending
            ? 'Your join request is pending'
            : null,
      canSend,
      verificationReason,
    });

  return (
    <>
      <ChatAreaLayout
        {...state}
        conversation={effectiveConv}
        onClearChat={clearChat.request}
        showChatOnMobile={showChatOnMobile}
        isLoading={isLoading}
        notFound={notFound}
        hasMore={hasMore}
        isLoadingMore={isLoadingMore}
        onLoadMore={onLoadMore}
        onMarkSeen={onMarkSeen}
        onRetryUpload={onRetryUpload}
        onRetrySend={onRetrySend}
        onCancelUpload={onCancelUpload}
        onSendMessage={onSendMessage}
        onBack={onBack}
        onNewMessage={onNewMessage}
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
            onClearChat={clearChat.request}
            onToggleSearch={() => {
              if (state.showSearch) {
                state.closeSearch();
              } else {
                state.openSearch();
              }
            }}
            onOpenDetails={() => state.setShowDetails(true)}
            isAdmin={isAdmin}
          />
        }
      />
      {clearChat.dialog}
    </>
  );
}
