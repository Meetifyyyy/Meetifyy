/**
 * The people an activity invite can be offered to: everyone the viewer follows
 * plus everyone they have a one-to-one chat with, each person once.
 *
 * Two existing, server-paged lists are read side by side rather than adding an
 * endpoint:
 *   - `GET /api/users/:username/following` with `eligibleOnly` (verified,
 *     active, not blocked), and
 *   - `GET /api/messages` with `eligibleOnly` (sendable threads), whose
 *     one-to-one rows carry the other person as `targetUser`.
 * Both match the search term in the database before their page limit, so a
 * person past the first page is still found by typing. Each list keeps its own
 * offset and stops asking once it comes back short.
 *
 * Who is already in the activity is not decided here: that is host-only
 * information the invite sheet reads separately.
 */
import { useMemo } from 'react';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { messagesApi, usersApi } from '@shared/api/apiClient';
import { selectableUsers, sendableConversations } from '@shared/lib/conversationTargets';
import { useAuth } from '@shared/context/AuthContext';
import { useDebounce } from '@shared/hooks/useDebounce';

export const INVITABLE_PEOPLE_PAGE_SIZE = 50;

/** The other person in each one-to-one chat; group threads have none. */
function chatPartners(conversations) {
  return sendableConversations(conversations)
    .filter((c) => !c.isGroup && c.type !== 'GROUP')
    .map((c) => c.targetUser);
}

/** The next offset for a list, or null once it came back short. */
function nextOffset(rows, offset) {
  if (offset === null) return null;
  return rows.length >= INVITABLE_PEOPLE_PAGE_SIZE ? offset + INVITABLE_PEOPLE_PAGE_SIZE : null;
}

/** @param {string} search What the viewer typed; debounced here. */
export function useInvitablePeople(search = '') {
  const { currentUser } = useAuth();
  const term = useDebounce((search || '').trim(), 250);
  const username = currentUser?.username;

  const query = useInfiniteQuery({
    queryKey: ['invitable-people', currentUser?.id, term],
    enabled: Boolean(username),
    initialPageParam: { following: 0, chats: 0 },
    queryFn: async ({ pageParam }) => {
      const [following, chats] = await Promise.all([
        pageParam.following === null
          ? []
          : usersApi.getFollowing(username, INVITABLE_PEOPLE_PAGE_SIZE, pageParam.following, true, term),
        pageParam.chats === null
          ? []
          : messagesApi.getConversations(INVITABLE_PEOPLE_PAGE_SIZE, pageParam.chats, true, term),
      ]);
      return {
        users: selectableUsers([...chatPartners(chats), ...following]),
        next: {
          following: nextOffset(following, pageParam.following),
          chats: nextOffset(chats, pageParam.chats),
        },
      };
    },
    getNextPageParam: (last) =>
      last.next.following !== null || last.next.chats !== null ? last.next : undefined,
    staleTime: 30_000,
    // Keeps the previous term's rows on screen while the next request is in
    // flight, so the grid does not blink empty between keystrokes.
    placeholderData: keepPreviousData,
  });

  const people = useMemo(() => {
    const byId = new Map();
    for (const page of query.data?.pages ?? []) {
      for (const user of page.users) {
        if (String(user.id) !== String(currentUser?.id) && !byId.has(user.id)) byId.set(user.id, user);
      }
    }
    return [...byId.values()];
  }, [query.data, currentUser?.id]);

  return {
    people,
    isLoading: query.isPending && Boolean(username),
    isError: query.isError,
    refetch: query.refetch,
    hasMore: Boolean(query.hasNextPage),
    loadMore: query.fetchNextPage,
    isLoadingMore: query.isFetchingNextPage,
  };
}

export default useInvitablePeople;
