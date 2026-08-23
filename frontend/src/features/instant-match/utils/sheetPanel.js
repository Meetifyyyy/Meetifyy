/**
 * Which panel the Instant Match sheet shows when the user is not filling in
 * the search form.
 *
 * Extracted and named because the distinction is easy to get wrong, and was:
 * what matters is whether the chat is *live*, not whether a chat object
 * exists. An ended chat is still present in state — that is how the person
 * who stayed learns what happened — so keying the matched panel on its mere
 * existence put the celebration screen back over a dead match, showing a
 * partner it no longer had.
 */
export function resolveSheetPanel({ status, searching, chat, recentMatch }) {
  const onIdleSurface = (status === 'matched' || status === 'idle') && !searching;
  if (!onIdleSurface) return 'form';

  if (chat?.isActive) return 'matched';
  if (chat) return 'ended';

  // No chat state yet, but a pairing is known — the gap between accepting a
  // match and the chat state landing.
  if (recentMatch) return 'matched';

  return 'form';
}
