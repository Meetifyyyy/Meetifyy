import { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usersApi } from '../api/apiClient';
import { useAuth } from '../context/AuthContext';
import { useConversations } from './useMessages';
import { useCampusUsers } from './useProfile';

/**
 * The `{ [userId]: user }` lookup map that `useData` used to build inline.
 *
 * Assembled from three sources, exactly as `useData` did:
 *   1. the general `['users']` list (20, deferred to idle) — mention lookups
 *   2. campus users
 *   3. every participant / member / memberDetail of every conversation
 *
 * Extracted from the former `useData` mega-hook, which built this map inline
 * and re-exported it to every consumer.
 *
 * NOTE: this is an object map keyed by id, not an array. `usersMap[senderId]`
 * is the intended access pattern; the raw `['users']` query returns an array
 * and is not a drop-in substitute.
 *
 * Built ONCE by <UsersMapProvider> at the app root and read through context.
 * Consumers include MessageBubble and RichText, which mount per message (and
 * per feed post and per comment) -- computing the map inside each of them
 * meant rebuilding it a hundred-plus times per screen and registering a query
 * observer and an idle timer for every instance. The old mega-hook built it
 * once because it was itself mounted once; the provider restores that while
 * keeping the narrow subscription.
 */
const UsersMapContext = createContext(null);

const EMPTY_USERS_MAP = {};
// Stable identity so the map memo below is not busted by a fresh `[]` default
// on every render while the query is still loading.
const EMPTY_USERS = [];

function useBuildUsersMap() {
  const { currentUser } = useAuth();

  // Deferred to idle time so a globally-mounted consumer doesn't fire this
  // during the initial page render.
  const [isIdleLoaded, setIsIdleLoaded] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsIdleLoaded(true);
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

  const { data: rawUsers = EMPTY_USERS } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.getAll(20, 0),
    enabled: Boolean(currentUser?.id && isIdleLoaded),
    staleTime: 5 * 60_000,
  });
  // Was `useCampusUsers(isIdleLoaded ? 50 : 0)`. The limit-0 form still issued a
  // real GET /users/campus?limit=0 (plus its CORS preflight) that always came
  // back `[]`, so it contributed nothing to the map. Holding the query disabled
  // until idle keeps the same deferral without the wasted round trip.
  const { campusUsers: rawCampusUsers } = useCampusUsers(50, { enabled: isIdleLoaded });
  const { conversations: processedConversations } = useConversations();

  return useMemo(() => {
    const map = {};
    (rawUsers || []).forEach(u => { if (u?.id) map[u.id] = u; });
    (rawCampusUsers || []).forEach(u => { if (u?.id) map[u.id] = u; });
    (processedConversations || []).forEach(c => {
      if (c.targetUser?.id) map[c.targetUser.id] = c.targetUser;
      if (c.otherUser?.id) map[c.otherUser.id] = c.otherUser;
      if (Array.isArray(c.participants)) {
        c.participants.forEach(p => {
          if (p?.id && (p?.username || p?.displayName || p?.name)) map[p.id] = p;
          else if (p?.user?.id) map[p.user.id] = p.user;
        });
      }
      if (Array.isArray(c.members)) {
        c.members.forEach(m => {
          if (m?.id && (m?.username || m?.displayName || m?.name)) map[m.id] = m;
          else if (m?.user?.id) map[m.user.id] = m.user;
        });
      }
      if (Array.isArray(c.memberDetails)) {
        c.memberDetails.forEach(m => {
          if (m?.userId) map[m.userId] = { id: m.userId, displayName: m.displayName, username: m.username, avatar: m.avatar };
        });
      }
    });
    return map;
  }, [rawUsers, rawCampusUsers, processedConversations]);
}

export function UsersMapProvider({ children }) {
  const value = useBuildUsersMap();
  return <UsersMapContext.Provider value={value}>{children}</UsersMapContext.Provider>;
}

/**
 * Read the shared users map. Returns a stable empty object when no provider is
 * mounted, so a consumer rendered outside the tree degrades to "no known
 * users" rather than throwing -- the same shape callers already handle.
 */
export function useUsersMap() {
  return useContext(UsersMapContext) ?? EMPTY_USERS_MAP;
}
