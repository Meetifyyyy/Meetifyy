import { useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { dmApi } from '@shared/api/apiClient';
import { useAuth } from '@shared/context/AuthContext';
import { useConversations } from './useMessages';
import { generateConversationUrl } from '@shared/utils/conversationUrl';

/**
 * Opens the direct-message thread with a user, from anywhere.
 *
 * Every "Send message" button needs the same three-step resolution — the
 * conversation we already have loaded, the one the server knows about, or a
 * fresh draft — and this used to be copy-pasted per call site. Two copies had
 * already drifted into being byte-identical duplicates of a version with the
 * same two flaws, and any third would have inherited them.
 *
 *  1. The local conversation list. This is the processed list from
 *     `useConversations`, which normalises the other participant onto `userId`
 *     and contains only conversations the viewer can actually open. The old
 *     version read the raw query cache and filtered on `c.type === 'DM'`, a
 *     field the processed shape does not carry, so the fast path never matched
 *     and every click paid a network round-trip.
 *
 *  2. `lookupDM`. Note this can only ever be a hint: between the lookup and the
 *     navigation the conversation could be deleted. Step 3 is the safety net.
 *
 *  3. A draft route. Nothing is written to the database until the first message
 *     is sent, and sending revives a previously deleted conversation — empty,
 *     because deletion also stamps a `clearedAt` watermark.
 *
 * Returns `openDirectMessage(user)`; `user` needs an `id`, and anything else on
 * it is passed through as router state so the draft screen can render the
 * recipient immediately.
 */
export function useOpenDirectMessage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentUser } = useAuth();
  const { conversations } = useConversations();

  return useCallback(async (user) => {
    const targetId = user?.id;
    if (!targetId) return;
    // Messaging yourself is not a thing; callers also guard, but a shared entry
    // point should not depend on every one of them remembering.
    if (currentUser?.id && String(currentUser.id) === String(targetId)) return;

    const from = location.pathname;
    const openConversation = (conversation) =>
      navigate(generateConversationUrl(conversation, currentUser?.id, '/messages'), { state: { from } });

    const existing = (conversations || []).find(
      (c) => !c.isGroup && c.userId && String(c.userId) === String(targetId),
    );
    if (existing) {
      openConversation(existing);
      return;
    }

    try {
      const lookup = await dmApi.lookupDM(targetId);
      if (lookup?.publicId || lookup?.id) {
        openConversation(lookup);
        return;
      }
    } catch {
      // A failed lookup is not a failed action — fall through to the draft,
      // which works offline and creates nothing until a message is sent.
    }

    navigate(`/messages/new?user=${targetId}`, { state: { from, targetUser: user } });
  }, [navigate, location.pathname, currentUser?.id, conversations]);
}
