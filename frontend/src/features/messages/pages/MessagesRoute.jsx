import { useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import MessagesLayout from '../components/layout/MessagesLayout';

import PullToRefresh from '@shared/components/PullToRefresh';
import VerificationGate from '@shared/components/VerificationGate/VerificationGate';

export default function MessagesRoute() {
  // The keyboard geometry this layout depends on (`--kb-inset`, used by
  // `.centre--messages` in global.css) is published once by
  // DashboardLayoutWrapper, which is also where the BottomNav that reads it
  // lives. It used to be mounted here, which meant every other screen — the
  // post composer most visibly — got no keyboard handling at all.
  const { param1, param2 } = useParams();
  const isChatOpen = !!(param1 || param2);

  const queryClient = useQueryClient();

  /*
   * The inbox list and its metadata — the last message, unread counts, order.
   * Not `['messages', id]`: a conversation's own history is not what this
   * gesture refreshes, and it is live over the socket anyway.
   *
   * `invalidateQueries`, NOT `resetQueries`.
   *
   * Reset DISCARDS the cached data, which makes the screen fall back to its
   * loading state. On this screen that meant the skeleton early-return fired,
   * which unmounted the <PullToRefresh> wrapper itself — so the content the
   * user had just pulled down was destroyed mid-gesture and replaced by a
   * skeleton sitting at offset zero. That is the snap: not the spinner moving,
   * but the page underneath it being thrown away and rebuilt.
   *
   * Invalidate keeps the current data on screen and refetches behind it, which
   * is what a pull-to-refresh is supposed to look like anyway — the list stays
   * put and updates in place.
   */
  const handleRefresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['conversations'] }),
    [queryClient],
  );

  return (
    /*
     * The INBOX LIST only. `disabled` while a conversation is open, because
     * this one route renders both: pulling inside a chat would reload the list
     * behind it, and a chat thread scrolls from the bottom, so the gesture
     * would fight the thing the user is actually reading.
     *
     * When the list is scrolled away from its top the hook declines on its own
     * — it walks up from the touch target and finds a scroller that is not at
     * zero — so this flag only has to handle the case the DOM cannot express.
     */
    <PullToRefresh onRefresh={handleRefresh} disabled={isChatOpen}>
      <main className={`centre centre-wide centre--messages animate-in ${isChatOpen ? 'chat-is-open' : ''}`}>
        <VerificationGate message="Verify your student ID to send and receive messages." fullPage>
          <MessagesLayout />
        </VerificationGate>
      </main>
    </PullToRefresh>
  );
}
