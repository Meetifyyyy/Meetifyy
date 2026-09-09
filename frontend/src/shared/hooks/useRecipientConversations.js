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
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { messagesApi } from '@shared/api/apiClient';
import { sendableConversations } from '@shared/lib/conversationTargets';
import { useDebounce } from '@shared/hooks/useDebounce';

export const RECIPIENT_CONVERSATIONS_KEY = ['conversations', 'recipients'];

/** How many threads a picker shows before the user has typed anything. */
export const RECIPIENT_PAGE_SIZE = 50;

/**
 * @param {boolean} enabled Whether the picker is open.
 * @param {string} search What the user has typed. Sent to the server, which
 *   matches it against the group's name or the DM partner's handle BEFORE
 *   applying the page limit. Filtering the page in the browser instead was the
 *   bug this parameter fixes: a user with more eligible threads than the page
 *   size could not reach the rest by typing, because they had never been
 *   fetched.
 */
export function useRecipientConversations(enabled = true, search = '') {
  // One request per pause in typing rather than one per keystroke.
  const debouncedSearch = useDebounce((search || '').trim(), 250);

  const { data = [], isLoading, isFetching, error } = useQuery({
    // The term is part of the key: two searches are two different lists, and
    // sharing one entry would show the results of whichever resolved last.
    queryKey: [...RECIPIENT_CONVERSATIONS_KEY, debouncedSearch],
    queryFn: () =>
      messagesApi.getConversations(RECIPIENT_PAGE_SIZE, 0, true, debouncedSearch),
    enabled: Boolean(enabled),
    // Matches the inbox list: long enough that reopening a modal is instant,
    // short enough that a verification change is picked up quickly.
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    // Keeps the previous term's rows on screen while the next request is in
    // flight, so the list does not blink empty between keystrokes.
    placeholderData: keepPreviousData,
  });

  const conversations = useMemo(() => sendableConversations(data), [data]);

  return {
    conversations,
    isLoading,
    isFetching,
    // True while the results on screen still belong to an earlier search term.
    isSearching: debouncedSearch !== (search || '').trim() || isFetching,
    error,
  };
}

export default useRecipientConversations;
