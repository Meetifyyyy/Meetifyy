import React from 'react';
import { useInstantMatch } from '../../context/InstantMatchContext';
import { Bolt, Squiggle } from '../decor/Decor';

/**
 * What Instant Match shows once a conversation is over.
 *
 * This is the screen the person who *stayed* comes back to — the one who
 * left never reaches it, because their own state is cleared as they go. It
 * exists so returning to Instant Match after the other person walked away
 * explains itself, rather than presenting a fresh activity grid as if the
 * match had never happened.
 *
 * Someone leaving and a window running out are worded differently on purpose.
 * Telling a user their match "expired" when the other person actually left is
 * a small lie, and it makes the product feel broken in a way that is hard to
 * put a finger on.
 */
export default function EndedPanel() {
  const { chat, matchPartner, leaveMatch, leaving } = useInstantMatch();
  if (!chat) return null;

  const partnerName = matchPartner?.displayName || matchPartner?.username || 'They';
  const copy = describeEnding(chat, partnerName);

  return (
    <div className="im-ended">
      <span className="im-sticker im-sticker-coral">{copy.badge}</span>
      <h3 className="im-display im-display-lg im-ended-title">{copy.title}</h3>
      <Squiggle className="im-ended-squiggle" />
      <p className="im-lede im-ended-lede">{copy.body}</p>

      <button
        type="button"
        className="im-btn im-btn-yes im-ended-action"
        onClick={() => leaveMatch({ alreadyEnded: true })}
        disabled={leaving}
      >
        Find someone new
        <Bolt className="im-btn-bolt" />
      </button>
    </div>
  );
}

function describeEnding(chat, partnerName) {
  if (chat.endReason === 'expired') {
    return {
      badge: 'Time up',
      title: 'Your Instant Match has ended',
      body: 'Your 24-hour chat window has expired.',
    };
  }
  if (chat.endReason === 'you_left') {
    return {
      badge: 'Left',
      title: 'You left this match',
      body: 'That conversation is closed. Start a new search whenever you like.',
    };
  }
  return {
    badge: 'Ended',
    title: `${partnerName} left the match`,
    body: 'Your Instant Match conversation has ended.',
  };
}
