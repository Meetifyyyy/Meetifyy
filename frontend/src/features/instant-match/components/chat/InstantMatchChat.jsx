import { lazy, Suspense, useState } from 'react';
import { useAuth } from '@shared/context/AuthContext';
import { useScrollLock } from '@shared/hooks/useScrollLock';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';
import { useInstantMatch } from '../../context/InstantMatchContext';

/**
 * The surface is loaded only once a match chat is actually open.
 *
 * It renders the real messaging stack — useChatManager, ChatMessageList,
 * ChatInputArea and everything those reach — and this overlay is mounted at the
 * app shell, so importing it statically put the entire Messages feature into
 * the entry chunk. Every visitor to Home downloaded and parsed the chat UI for
 * a conversation most of them will never have.
 *
 * The gate below is the part that must stay eager: it holds the hooks whose
 * order cannot change, and it is a few lines. Everything heavy is behind the
 * `open` check, which is exactly when the user has committed to the chat.
 */
const InstantMatchChatSurface = lazy(() => import('./InstantMatchChatSurface'));

/**
 * The dedicated full-screen Instant Match conversation.
 *
 * Deliberately its own surface rather than a route into Messages: this chat
 * is temporary, it is reached only through Instant Match, and it never
 * appears in the conversation list. What it does *not* do is reimplement
 * messaging — the thread, the composer, the realtime plumbing, optimistic
 * sends, media upload and read receipts are all the existing components,
 * driven by the same `useChatManager`. Only the frame around them is new.
 *
 * `useChatManager` looks a conversation up in the conversation list to derive
 * id aliases, and finds nothing here — by design, since Instant Match chats
 * are excluded from that list. It degrades to using the id it was given,
 * which is the one the server already joined both sockets to when the match
 * was accepted, so realtime works without the chat ever being listed.
 *
 * There is deliberately no way to leave the match from in here while it is
 * live. Ending the conversation is a decision, and it belongs on the matched
 * panel that Instant Match opens on — the hub where the user picks what to
 * do. This screen is for talking, and a destructive action sitting under the
 * composer was only ever going to be mis-tapped.
 */
export default function InstantMatchChat() {
  const {
    chatOverlayOpen, closeChatOverlay, chat, matchPartner,
    leaveMatch, leaving, isVerified,
  } = useInstantMatch();
  const { currentUser } = useAuth();

  const [replyingTo, setReplyingTo] = useState(null);
  const [startersDismissed, setStartersDismissed] = useState(false);

  const open = isVerified && chatOverlayOpen && Boolean(chat);
  useScrollLock(open);
  // Back leaves the Instant Match chat the same way its own back arrow and
  // Escape do. It is a full-screen overlay mounted at the app shell rather
  // than a route, so without this a Back press navigated the page hidden
  // underneath it and left the chat (and its scroll lock) on top of a page
  // the user never chose.
  useOverlayBack(open, closeChatOverlay);

  if (!isVerified || !open) return null;
  return (
    <Suspense fallback={null}>
      <InstantMatchChatSurface
        chat={chat}
        partner={matchPartner}
        currentUser={currentUser}
        replyingTo={replyingTo}
        setReplyingTo={setReplyingTo}
        startersDismissed={startersDismissed}
        setStartersDismissed={setStartersDismissed}
        onClose={closeChatOverlay}
        onLeave={leaveMatch}
        leaving={leaving}
      />
    </Suspense>
  );
}

