import { useState } from 'react';
import { useInstantMatch } from '../../context/InstantMatchContext';
import { useAuth } from '@shared/context/AuthContext';
import { getActivity, getActivityVerb, accentVars } from '../../constants/matchConstants';
import { useCountdown } from '../../hooks/useCountdown';
import { MeetScene } from '../art/CampusMap';
import { ActivityIcon, ClockIcon, ChatIcon, SpinnerIcon } from '../art/icons';
import { MatchMark } from '../decor/Decor';
import Face, { firstName } from '../art/Face';
import LeaveMatchModal from '../modals/LeaveMatchModal';

/**
 * Shown when the user reopens Instant Match after a mutual accept.
 *
 * This panel is the hub: reaching Instant Match while matched lands here, and
 * both choices — open the conversation, or walk away and search again — are
 * made from this one screen. The chat itself is then only for chatting.
 *
 * The two people stand where their routes met on the map, so the screen says
 * "you found each other" before any copy is read.
 *
 * Leaving is destructive and permanent, so it never fires on the first tap:
 * the confirmation names the other person and states the consequence.
 */
export default function MatchedPanel() {
  const {
    recentMatch, openMatchChat, busy, chat, matchPartner, leaveMatch, leaving,
    unreadCount,
  } = useInstantMatch();
  const [confirmLeave, setConfirmLeave] = useState(false);
  const { currentUser } = useAuth();

  // The chat's own deadline, falling back to the pairing's.
  const expiresAt = chat?.expiresAt ?? recentMatch?.expiresAt ?? null;
  const { label: timeLabel, remainingMs } = useCountdown(expiresAt);

  // A live chat is reason enough to render this panel. `recentMatch` is the
  // richer payload and is used when present, but it arrives from a different
  // request than the chat state does — so on a slow resync the chat can be
  // known before the pairing is.
  if (!recentMatch && !chat) return null;

  const candidate = recentMatch?.candidate ?? matchPartner ?? null;
  const activity = recentMatch?.activity ?? chat?.matchReason ?? chat?.activity ?? '';
  // The dedicated chat's own state is the authority on whether there is
  // anything to open.
  const chatReady = chat ? chat.isActive : Boolean(recentMatch.chatId);
  const activityMeta = getActivity(activity);

  const youName = firstName(currentUser?.displayName || currentUser?.username) || 'You';
  const themName = firstName(candidate?.displayName || candidate?.username) || 'your match';
  const showUnread = !busy && chat?.isActive && unreadCount > 0;

  return (
    <div className="im-matched">
      <MeetScene variant="match" className="im-matched-scene im-scene-fade">
        <span className="im-pair">
          <Face
            className="im-pair-face im-pair-you"
            avatar={currentUser?.avatar || currentUser?.avatarUrl}
            name={youName}
            size={76}
          />
          <span className="im-pair-node"><MatchMark /></span>
          <Face
            className="im-pair-face im-pair-them"
            avatar={candidate?.avatar}
            name={themName}
            size={76}
          />
        </span>
      </MeetScene>

      <div className="im-matched-copy">
        <span className="im-eyebrow im-eyebrow-blue">Matched</span>
        <h3 className="im-title im-title-lg">You and {themName}</h3>
      </div>

      <ul className="im-facts">
        <li style={accentVars(activityMeta)}>
          <span className="im-icon-tile im-icon-tile-sm" aria-hidden="true">
            <ActivityIcon id={activity} />
          </span>
          <span>You both wanted to {getActivityVerb(activity)}</span>
        </li>
        {expiresAt && chatReady && (
          <li>
            <span className="im-icon-tile im-icon-tile-sm im-icon-tile-neutral" aria-hidden="true">
              <ClockIcon />
            </span>
            <span>
              Chat open for <strong>{remainingMs > 0 ? timeLabel : 'a little longer'}</strong>
            </span>
          </li>
        )}
      </ul>

      <div className="im-panel-actions">
        {/* Always offered. A missing `chatId` is usually a momentary gap, and
            the handler re-asks the server rather than doing nothing. */}
        <button
          type="button"
          className="im-btn im-btn-primary im-btn-block"
          onClick={openMatchChat}
          disabled={busy}
          aria-busy={busy || undefined}
        >
          {busy ? <SpinnerIcon className="im-spinner-on-blue" /> : <ChatIcon />}
          {busy ? 'Opening…' : 'Open chat'}
          {showUnread && (
            <span className="im-badge" aria-hidden="true">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
        <button
          type="button"
          className="im-btn im-btn-ghost im-btn-block"
          onClick={() => setConfirmLeave(true)}
          disabled={leaving}
        >
          Find someone new
        </button>

        {!chatReady && !busy && (
          <p className="im-panel-note">
            {chat && !chat.isActive
              ? 'This chat has ended. Open it to see what happened.'
              : 'Getting your chat ready. Tap Open chat if it does not open.'}
          </p>
        )}
      </div>

      {showUnread && (
        <span className="im-sr-only" role="status">
          {unreadCount} new message{unreadCount === 1 ? '' : 's'} from {themName}
        </span>
      )}

      {confirmLeave && (
        <LeaveMatchModal
          partnerName={themName}
          busy={leaving}
          onCancel={() => setConfirmLeave(false)}
          onConfirm={async () => {
            const ok = await leaveMatch({ alreadyEnded: !chat?.isActive });
            if (ok) setConfirmLeave(false);
          }}
        />
      )}
    </div>
  );
}
