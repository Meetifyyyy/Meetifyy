/**
 * Keeping the shared-media gallery in step with the conversation.
 *
 * The gallery is served by its own query (`['conversation-media', ...]`), not
 * derived from the loaded message pages, so something has to tell it when the
 * conversation's media changes: a photo arrives or is confirmed, a message is
 * unsent, the chat is cleared or deleted. Every one of those already passes
 * through the message-cache helpers, which call these.
 *
 * Invalidation is by prefix on purpose. A message event may name the
 * conversation by any of its aliases (public id, internal id, a partner's
 * username) while the gallery is keyed by the one id the details panel holds,
 * and matching them is exactly the guesswork the old gallery got wrong. Marking
 * the prefix stale costs nothing for galleries that are not on screen - they
 * refetch only when next opened - and refetches the one that is.
 */
export const CONVERSATION_MEDIA_KEY = 'conversation-media';

/** True when the message carries a photo or video that belongs in a gallery. */
export function messageCarriesGalleryMedia(message) {
  if (!message || typeof message !== 'object') return false;
  const payload = message.payload && typeof message.payload === 'object' ? message.payload : {};
  const url = message.mediaUrl || payload.mediaUrl;
  if (typeof url !== 'string' || url === '') return false;
  const type = String(message.mediaType || payload.mediaType || message.type || '').toLowerCase();
  if (type.includes('audio') || type.includes('voice')) return false;
  return true;
}

/** An optimistic message has no server row yet; the gallery cannot contain it. */
export function isConfirmedMessage(message) {
  const id = message && message.id != null ? String(message.id) : '';
  return Boolean(id) && !id.startsWith('temp_') && !id.startsWith('c_temp_') && !message.isOptimistic;
}

export function invalidateConversationMedia(queryClient) {
  if (!queryClient) return;
  queryClient.invalidateQueries({ queryKey: [CONVERSATION_MEDIA_KEY] });
}

export function removeConversationMedia(queryClient) {
  if (!queryClient) return;
  queryClient.removeQueries({ queryKey: [CONVERSATION_MEDIA_KEY] });
}
