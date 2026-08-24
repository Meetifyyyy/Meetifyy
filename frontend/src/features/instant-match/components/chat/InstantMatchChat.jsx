import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '@shared/context/AuthContext';
import { useScrollLock } from '@shared/hooks/useScrollLock';
import { showToast } from '@shared/utils/toast';
import Avatar from '@shared/components/avatar/Avatar';
import { useChatManager } from '@features/messages/shared/hooks/useChatManager';
import ChatMessageList from '@features/messages/shared/components/ChatMessageList';
import ChatInputArea from '@features/messages/shared/components/ChatInputArea';
import { useTypingIndicator } from '@features/messages/shared/hooks/useTypingIndicator';
import { useInstantMatch } from '../../context/InstantMatchContext';
import { useCountdown } from '../../hooks/useCountdown';
import { getActivity, getActivityVerb } from '../../constants/matchConstants';
import {
  getConversationStarters,
  STARTERS_MESSAGE_THRESHOLD,
} from '../../constants/conversationStarters';
import { Bolt } from '../decor/Decor';
import '../../styles/instant-match.css';
import '../../styles/instant-match-chat.css';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';

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
    leaveMatch, leaving,
  } = useInstantMatch();
  const { currentUser } = useAuth();

  const [replyingTo, setReplyingTo] = useState(null);
  const [startersDismissed, setStartersDismissed] = useState(false);

  const open = chatOverlayOpen && Boolean(chat);
  useScrollLock(open);
  // Back leaves the Instant Match chat the same way its own back arrow and
  // Escape do. It is a full-screen overlay mounted at the app shell rather
  // than a route, so without this a Back press navigated the page hidden
  // underneath it and left the chat (and its scroll lock) on top of a page
  // the user never chose.
  useOverlayBack(open, closeChatOverlay);

  if (!open) return null;
  return (
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
  );
}

/**
 * Split out so the hooks below never run for a closed overlay — and, more
 * importantly, so the hook order cannot change when `chat` arrives. Mounting
 * `useChatManager` above an early return was how the equivalent match popup
 * used to crash.
 */
function InstantMatchChatSurface({
  chat, partner, currentUser, replyingTo, setReplyingTo,
  startersDismissed, setStartersDismissed,
  onClose, onLeave, leaving,
}) {
  const conversationId = chat.conversationId;

  const {
    messages, isLoading, isError, hasMore, isLoadingMore, onLoadMore,
    sendMessageOptimistically, retryUpload, cancelUpload, markSeenIfEligible,
  } = useChatManager(conversationId, 'messages', currentUser);

  const { label: timeLabel } = useCountdown(chat.expiresAt, chat.onCountdownElapsed);

  // Typing rides the same conversation room as messages, so it works here
  // without any Instant-Match-specific plumbing.
  const {
    handleKeystroke, stopTypingNow, typingUsers, isTyping,
  } = useTypingIndicator(conversationId, currentUser?.id);

  // A chat that has ended must not leave the other person's "typing…"
  // hanging on screen, and must not keep announcing this user as typing.
  useEffect(() => {
    if (!chat.isActive) stopTypingNow?.();
  }, [chat.isActive, stopTypingNow]);

  const activityMeta = getActivity(chat.matchReason || chat.activity);
  const partnerName = partner?.displayName || partner?.username || 'Your match';

  // Escape closes the chat. It never leaves the match — that decision is not
  // reachable from this screen at all.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  /** A synthetic conversation for the shared components, which expect one. */
  const conversation = useMemo(() => ({
    id: conversationId,
    type: 'INSTANT_MATCH',
    isInstantMatch: true,
    name: partnerName,
    expiresAt: chat.expiresAt,
    targetUser: partner || null,
  }), [conversationId, partnerName, chat.expiresAt, partner]);

  const realMessageCount = useMemo(
    () => (messages || []).filter((m) => (m.type || '').toLowerCase() !== 'system').length,
    [messages],
  );

  const showStarters =
    chat.isActive && !startersDismissed && realMessageCount < STARTERS_MESSAGE_THRESHOLD;

  const starters = useMemo(
    () => getConversationStarters(chat.matchReason || chat.activity),
    [chat.matchReason, chat.activity],
  );

  const handleSend = useCallback((payload) => {
    // Belt to the backend's braces: the server rejects a write into an ended
    // chat regardless, but there is no reason to spend a round trip finding
    // that out when this client already knows.
    if (!chat.isActive) {
      showToast('This Instant Match has ended', 'error');
      return;
    }
    sendMessageOptimistically(payload);
    setReplyingTo(null);
  }, [chat.isActive, sendMessageOptimistically, setReplyingTo]);

  const handleStarter = useCallback((text) => {
    if (!chat.isActive) return;
    setStartersDismissed(true);
    sendMessageOptimistically({ text, mentions: [] });
  }, [chat.isActive, sendMessageOptimistically, setStartersDismissed]);

  const endedCopy = describeEnding(chat, partnerName);

  return createPortal(
    <div
      className="im-scope im-chat-root"
      role="dialog"
      aria-modal="true"
      aria-label="Instant Match chat"
      onMouseDown={(e) => {
        // On desktop the chat is a window on a dimmed backdrop, so clicking
        // the backdrop closes it — the expected gesture for a window. The
        // scrim does not exist on mobile, where the root is the surface
        // itself, so this can only ever fire on the desktop layout.
        if (e.target === e.currentTarget) onClose();
      }}
    >
     <div className="im-chat-window">
      <header className="im-chat-head">
        <button
          type="button"
          className="im-chat-back"
          onClick={onClose}
          aria-label="Close Instant Match chat"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        <span className="im-chat-avatar">
          <Avatar src={partner?.avatar} name={partnerName} size="100%" />
        </span>

        <div className="im-chat-identity">
          <span className="im-chat-eyebrow">
            <Bolt className="im-chat-eyebrow-bolt" /> Instant Match
          </span>
          <span className="im-chat-name">{partnerName}</span>
        </div>

        {/* The countdown re-renders once a minute above an hour — see
            useCountdown. It reads a fixed server timestamp and never polls. */}
        <span
          className={`im-chat-timer ${chat.isActive ? '' : 'im-chat-timer-off'}`}
          aria-live="off"
        >
          {chat.isActive ? `${timeLabel} remaining` : 'Ended'}
        </span>
      </header>

      {/* Why these two were put together — the thing that makes this not a DM. */}
      <div className="im-chat-reason">
        <span aria-hidden="true">{activityMeta?.emoji ?? '⚡'}</span>
        <span>You both wanted to {getActivityVerb(chat.matchReason || chat.activity)}</span>
      </div>

      <div className="im-chat-body">
        <ChatMessageList
          isLoading={isLoading}
          error={isError}
          messages={messages}
          conversation={conversation}
          currentUser={currentUser}
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          onLoadMore={onLoadMore}
          onReply={setReplyingTo}
          onReplyTo={setReplyingTo}
          replyingTo={replyingTo}
          onMarkSeen={markSeenIfEligible}
          isTyping={chat.isActive && isTyping}
          typingUsers={chat.isActive ? typingUsers : new Map()}
          onRetryUpload={retryUpload}
          onCancelUpload={cancelUpload}
        />
      </div>

      {chat.isActive && showStarters && (
        <div className="im-chat-starters">
          <div className="im-chat-starters-head">
            <span className="im-eyebrow">Not sure how to start?</span>
            <button
              type="button"
              className="im-chat-starters-hide"
              onClick={() => setStartersDismissed(true)}
            >
              Hide
            </button>
          </div>
          <ul className="im-chat-starter-list">
            {starters.map((prompt) => (
              <li key={prompt}>
                <button type="button" className="im-chat-starter" onClick={() => handleStarter(prompt)}>
                  {prompt}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {chat.isActive ? (
        <div className="im-chat-foot">
          <ChatInputArea
            conversation={conversation}
            onSendMessage={handleSend}
            replyingTo={replyingTo}
            onCancelReply={() => setReplyingTo(null)}
            onTyping={handleKeystroke}
            stopTypingNow={stopTypingNow}
          />
        </div>
      ) : (
        /* An ended chat is never left as an empty room with a dead input.
           The thread stays readable above; this replaces the composer with
           the one action that still makes sense. */
        <div className="im-chat-ended" role="status">
          <p className="im-chat-ended-title">{endedCopy.title}</p>
          <p className="im-chat-ended-lede">{endedCopy.body}</p>
          <button
            type="button"
            className="im-btn im-btn-yes im-btn-sm"
            onClick={() => onLeave({ alreadyEnded: true })}
          >
            Find someone new
            <Bolt className="im-btn-bolt" />
          </button>
        </div>
      )}

     </div>

    </div>,
    document.body,
  );
}

/**
 * Ending copy, by cause.
 *
 * Someone walking away and a window running out are different events and are
 * worded differently on purpose — telling a user their match "expired" when
 * the other person actually left is a small lie that makes the product feel
 * broken.
 */
function describeEnding(chat, partnerName) {
  if (chat.endReason === 'expired') {
    return {
      title: 'Your Instant Match has ended',
      body: 'Your 24-hour chat window has expired.',
    };
  }
  if (chat.endReason === 'you_left') {
    return {
      title: 'You left this match',
      body: 'This conversation is closed. Start a new search whenever you like.',
    };
  }
  return {
    title: `${partnerName} left the match`,
    body: 'Your Instant Match conversation has ended.',
  };
}
