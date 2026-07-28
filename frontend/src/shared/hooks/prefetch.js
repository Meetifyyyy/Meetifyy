/**
 * prefetch.js — Predictive prefetch utilities.
 *
 * Attach these to onMouseEnter / onFocus handlers so data is already in
 * the React Query cache by the time the user clicks through. Zero-cost if
 * the data is already fresh (React Query skips the fetch automatically).
 *
 * Usage:
 *   import { prefetchProfile, prefetchCommunity, prefetchActivity } from '@shared/hooks/prefetch';
 *   ...
 *   <a onMouseEnter={() => prefetchProfile(queryClient, username)}>...</a>
 */
import { communitiesApi, activitiesApi, usersApi, messagesApi } from '@shared/api/apiClient';

// ── Community ────────────────────────────────────────────────────────────────

/**
 * Prefetch a community by ID on hover intent (card mouse-over, sidebar link).
 */
export function prefetchCommunity(queryClient, id) {
  if (!id || !queryClient) return;
  queryClient.prefetchQuery({
    queryKey: ['community', id],
    queryFn: () => communitiesApi.getById(id),
    staleTime: 5 * 60 * 1000,
  });
}

// ── Profile ──────────────────────────────────────────────────────────────────

/**
 * Prefetch a user profile by username on hover intent (mention, avatar, name link).
 */
export function prefetchProfile(queryClient, username) {
  if (!username || username === 'unknown' || !queryClient) return;
  queryClient.prefetchQuery({
    queryKey: ['profile', username],
    queryFn: () => usersApi.getByUsername(username),
    staleTime: 2 * 60 * 1000,
  });
}

// ── Activity ─────────────────────────────────────────────────────────────────

/**
 * Prefetch a crew activity by ID on hover intent (crew card mouse-over).
 */
export function prefetchActivity(queryClient, id) {
  if (!id || !queryClient) return;
  queryClient.prefetchQuery({
    queryKey: ['activity', id],
    queryFn: () => activitiesApi.getById(id),
    staleTime: 2 * 60 * 1000,
  });
}

// ── Messages ─────────────────────────────────────────────────────────────────

/**
 * Prefetch the first page of message history when entering the messages screen
 * or hovering a conversation row. Limits to 30 messages — enough to fill the screen.
 */
export function prefetchConversationHistory(queryClient, conversationId) {
  if (!conversationId || !queryClient) return;
  queryClient.prefetchQuery({
    queryKey: ['messages', conversationId],
    queryFn: () => messagesApi.getHistory(conversationId, null, null, 30),
    staleTime: 10 * 1000,
  });
}
