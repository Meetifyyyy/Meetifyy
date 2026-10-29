import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { groupApi } from '@shared/api/apiClient';
import { useChatAreaState } from '@features/messages/shared/hooks/useChatAreaState';
import { useMessagingEligibility } from '@shared/hooks/useMessagingEligibility';
import { resolveComposerState } from '@shared/utils/messagingEligibility';
import ChatAreaLayout from '@features/messages/shared/components/ChatAreaLayout';
import { useClearChatConfirm } from '@features/messages/shared/components/modals/ClearChatModal';
import GroupChatHeader from './GroupChatHeader';
import { useGroupJoinActivity } from '@features/messages/hooks/useGroupJoinActivity';

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
  const { currentUser, setShowDetails } = state;

  // `?panel=requests`: an admin's push for a new request to join. The
  // group's details open on its Join requests page, once: the address becomes
  // the details' own (`?view=details`) in one replace, so Back and a refresh
  // do not open the requests again.
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [detailsPage, setDetailsPage] = useState(null);
  // Asked for once per opening of the details: closing them forgets it.
  // Only on closing (open → closed): the details open through the address,
  // a render after the request, and clearing on "not open yet" undid it.
  const wasShowingDetails = useRef(false);
  useEffect(() => {
    if (wasShowingDetails.current && !state.showDetails) setDetailsPage(null);
    wasShowingDetails.current = Boolean(state.showDetails);
  }, [state.showDetails]);
  const openRequests = () => {
    setDetailsPage('requests');
    setShowDetails(true);
  };
  const wantsRequests = searchParams.get('panel') === 'requests';
  // Runs again if the inbox's own address fix-up (the slug) lands after it
  // and brings the old query back; the result is the same each time.
  useEffect(() => {
    if (!wantsRequests || !convId) return;
    setDetailsPage('requests');
    const params = new URLSearchParams(location.search);
    params.delete('panel');
    params.set('view', 'details');
    navigate({ pathname: location.pathname, search: `?${params}` }, { replace: true, state: location.state });
  }, [wantsRequests, convId, navigate, location.pathname, location.search, location.state]);
  // Clearing is confirmed first (ClearChatModal); the menus open the dialog.
  const clearChat = useClearChatConfirm(effectiveConv, onClearChat);

  const isBanned = effectiveConv?.myMembershipStatus === 'BANNED';
  // Out of the group: removed by an admin, left by choice, or (when this device
  // only knows the server's `isMember: false`) one of the two.
  // After a reload the live status is gone; the last departure line about the
  // viewer (it stays in their history) still says whether they left or were
  // removed.
  const lastDeparture = useMemo(() => {
    if (effectiveConv?.isMember !== false) return null;
    const messages = Array.isArray(effectiveConv?.messages) ? effectiveConv.messages : [];
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const event = messages[i]?.payload?.event;
      if (!event) continue;
      if (event.kind === 'member_removed' && String(event.targetId) === String(currentUser?.id)) return 'KICKED';
      if (event.kind === 'member_left' && String(event.actorId) === String(currentUser?.id)) return 'LEFT';
    }
    return null;
  }, [effectiveConv?.isMember, effectiveConv?.messages, currentUser?.id]);
  const isKicked = effectiveConv?.myMembershipStatus === 'KICKED'
    || (!effectiveConv?.myMembershipStatus && lastDeparture === 'KICKED');
  const hasLeft = effectiveConv?.myMembershipStatus === 'LEFT'
    || (!effectiveConv?.myMembershipStatus && lastDeparture === 'LEFT');
  const isOut = isKicked || hasLeft || effectiveConv?.isMember === false;
  const isPending = effectiveConv?.myMembershipStatus === 'PENDING';
  // The server's word on the viewer's role, from the group's details; only
  // the owner and admins are shown (or sent) the group's requests to join.
  const isReviewer = !isOut && (groupDetails?.myRole === 'OWNER' || groupDetails?.myRole === 'ADMIN');
  const joinActivity = useGroupJoinActivity(convId, { enabled: isReviewer });
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
        detailsInitialPage={detailsPage}
        adminUpdates={isReviewer ? joinActivity : null}
        onReviewRequests={openRequests}
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
