import { useState, useEffect, useMemo } from 'react';
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
 */
export function useUsersMap() {
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

  const { data: rawUsers = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.getAll(20, 0),
    enabled: Boolean(currentUser?.id && isIdleLoaded),
    staleTime: 5 * 60_000,
  });
  const { campusUsers: rawCampusUsers } = useCampusUsers(isIdleLoaded ? 50 : 0);
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
