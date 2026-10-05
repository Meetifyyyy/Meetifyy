import { useState } from 'react';
import { useRecipientConversations } from '@shared/hooks/useRecipientConversations';

/**
 * The people a Forward sheet can send to, searchable across ALL of them.
 *
 * Both Forward entry points (the in-chat sheet and the media viewer's) fetched
 * the first page of eligible conversations and let the sheet filter that page in
 * the browser, so anyone beyond the first 50 could not be found however exactly
 * they were typed. The search term now goes to the server, which matches it
 * before applying the page limit (see `useRecipientConversations`).
 *
 * @param {boolean} isOpen whether the sheet is open; nothing is fetched while closed.
 * @returns props for `ForwardMessageModal`: `conversations`, `isLoading`,
 *   `onSearchChange`.
 */
export function useForwardRecipients(isOpen) {
  const [search, setSearch] = useState('');
  const { conversations, isLoading, isSearching } = useRecipientConversations(Boolean(isOpen), search);

  return {
    conversations,
    // Also true while results for an earlier term are still on screen and the
    // next ones are on their way: rows already shown stay, and an empty list is
    // not announced as "no matches" before the answer has arrived.
    isLoading: isLoading || isSearching,
    onSearchChange: setSearch,
  };
}

export default useForwardRecipients;
