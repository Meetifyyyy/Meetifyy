/**
 * The two pure decisions the Forward modal makes, pulled out so they can be
 * tested without a DOM.
 *
 * Both existed inline and both were wrong in ways that were invisible on
 * screen: the filter matched only the display name, and every empty state
 * rendered the same sentence, which hid the fact that the list was ALWAYS empty
 * because nothing passed it in.
 */

/**
 * Recipients matching a search term.
 *
 * Matches username as well as display name: someone forwarding to "@zero"
 * should not have to remember that the chat is titled "Zero".
 */
export function filterForwardTargets(conversations, searchQuery) {
  const list = Array.isArray(conversations) ? conversations : [];
  const q = String(searchQuery || '').trim().toLowerCase();
  if (!q) return list;
  return list.filter(
    (c) =>
      (c?.name || '').toLowerCase().includes(q) ||
      (c?.username || '').toLowerCase().includes(q),
  );
}

/**
 * Which of the three states the recipient list is in.
 *
 * Rows already on hand always win: a background refetch must not replace a
 * list the person is choosing from. With none, a pending first load is
 * `'loading'` (the modal draws row skeletons), and only a settled, empty
 * result is `'empty'`.
 */
export function forwardListState({ isLoading, count }) {
  if (count > 0) return 'list';
  return isLoading ? 'loading' : 'empty';
}

/**
 * What to say when there is nothing to show.
 *
 * Three distinct situations were all rendered as "No conversations found":
 * still loading, searched for something with no match, and genuinely having
 * nobody to forward to. The first is the one that mattered, because while the
 * list was permanently broken the modal confidently reported an empty result.
 *
 * Loading has no sentence at all: the modal shows row skeletons for it, so an
 * empty-state message must never appear while the list is still arriving.
 */
export function forwardEmptyMessage({ isLoading, searchQuery }) {
  if (isLoading) return null;
  if (String(searchQuery || '').trim()) return 'No chats match that search';
  return 'No chats to forward to yet';
}
