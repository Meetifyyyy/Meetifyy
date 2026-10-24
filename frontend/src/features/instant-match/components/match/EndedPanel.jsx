import { useInstantMatch } from '../../context/InstantMatchContext';
import { MeetScene } from '../art/CampusMap';
import Face from '../art/Face';
import { ArrowRightIcon } from '../art/icons';

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
      <MeetScene variant="ended" className="im-ended-scene im-scene-fade">
        {matchPartner && (
          <Face
            className="im-ended-face"
            avatar={matchPartner.avatar}
            name={partnerName}
            size={56}
          />
        )}
      </MeetScene>

      <div className="im-ended-copy">
        <span className="im-eyebrow">{copy.badge}</span>
        <h3 className="im-title im-title-lg">{copy.title}</h3>
        <p className="im-lede">{copy.body}</p>
      </div>

      <div className="im-panel-actions">
        <button
          type="button"
          className="im-btn im-btn-primary im-btn-block"
          onClick={() => leaveMatch({ alreadyEnded: true })}
          disabled={leaving}
        >
          Find someone new
          <ArrowRightIcon />
        </button>
      </div>
    </div>
  );
}

function describeEnding(chat, partnerName) {
  if (chat.endReason === 'expired') {
    return {
      badge: 'Time up',
      title: 'Your Instant Match has ended',
      body: 'The 24-hour chat window closed. Start a new search whenever you like.',
    };
  }
  if (chat.endReason === 'you_left') {
    return {
      badge: 'You left',
      title: 'You left this match',
      body: 'That conversation is closed. Start a new search whenever you like.',
    };
  }
  return {
    badge: 'Match ended',
    title: `${partnerName} left the match`,
    body: 'Your Instant Match conversation has ended.',
  };
}
