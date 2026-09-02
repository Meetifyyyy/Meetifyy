/**
 * The conversation list for a recipient picker.
 *
 * Every Share modal (Post, Community, Activity, Profile) and Forward used to
 * call `useConversations()` — the inbox list — and show it as a list of places
 * to send to. Those are two different questions, and answering both from one
 * query is what let an unverified counterpart appear as a share target even
 * though `assertUsersEligible` refuses the send.
 *
 * This asks the server the picker's question instead: `eligibleOnly=true` makes
 * the database exclude one-to-one threads whose counterpart is not verified,
 * before LIMIT, so pagination stays correct. The inbox keeps its own unfiltered
 * query and still shows every thread, because history belongs to both people.
 *
 * The cache key is distinct for the same reason the server's is: sharing
 * `['conversations']` would let whichever list loaded first decide what the
 * other one saw, and in the wrong order the inbox would silently lose threads.
 *
 * `sendableConversations` is applied on top as a second line, not as the
 * enforcement — see shared/lib/conversationTargets.js.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { messagesApi } from '@shared/api/apiClient';
import { sendableConversations } from '@shared/lib/conversationTargets';

export const RECIPIENT_CONVERSATIONS_KEY = ['conversations', 'recipients'];

export function useRecipientConversations(enabled = true) {
  const { data = [], isLoading, error } = useQuery({
    queryKey: RECIPIENT_CONVERSATIONS_KEY,
    queryFn: () => messagesApi.getConversations(50, 0, true),
    enabled: Boolean(enabled),
    // Matches the inbox list: long enough that reopening a modal is instant,
    // short enough that a verification change is picked up quickly.
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const conversations = useMemo(() => sendableConversations(data), [data]);

  return { conversations, isLoading, error };
}

export default useRecipientConversations;
