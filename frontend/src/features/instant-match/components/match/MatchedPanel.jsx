import React from 'react';
import { useInstantMatch } from '../../context/InstantMatchContext';
import { useAuth } from '@shared/context/AuthContext';
import { getProcessedAvatarUrl } from '@shared/components/avatar/Avatar';
import { getActivity, getActivityVerb } from '../../constants/matchConstants';
import { Bolt, Starburst, Squiggle } from '../decor/Decor';
import LeaveMatchModal from '../modals/LeaveMatchModal';

/**
 * Shown when the user reopens Instant Match after a mutual accept.
 *
 * The pairing is the point, so both people are given equal weight: two
 * portraits facing each other with the bolt struck between them. Coming back
 * to a blank activity grid made a successful match feel like it had never
 * happened.
 */
export default function MatchedPanel() {
  const {
    recentMatch, openMatchChat, busy, chat, leaveMatch, leaving,
  } = useInstantMatch();
  const [confirmLeave, setConfirmLeave] = React.useState(false);
  const { currentUser } = useAuth();

  if (!recentMatch) return null;

  const { candidate, activity } = recentMatch;
  // The dedicated chat's own state is the authority on whether there is
  // anything to open — `recentMatch` describes the pairing, not the
  // conversation's lifecycle.
  const chatReady = chat ? chat.isActive : Boolean(recentMatch.chatId);
  const activityMeta = getActivity(activity);

  const you = {
    name: firstName(currentUser?.displayName || currentUser?.username) || 'You',
    avatar: currentUser?.avatar || currentUser?.avatarUrl,
  };
  const them = {
    name: firstName(candidate?.displayName || candidate?.username) || 'Them',
    avatar: candidate?.avatar,
  };

  return (
    <div className="im-matched">
      <div className="im-matched-stage">
        <Starburst className="im-matched-burst" points={16} />

        <Portrait person={you} tilt="-5deg" />

        <span className="im-matched-link" aria-hidden="true">
          <Bolt />
        </span>

        <Portrait person={them} tilt="5deg" />
      </div>

      <div className="im-matched-names">
        <span className="im-matched-name">{you.name}</span>
        <span className="im-matched-amp" aria-hidden="true">&</span>
        <span className="im-matched-name">{them.name}</span>
      </div>

      <div className="im-matched-copy">
        <span className="im-sticker im-sticker-lime">Matched</span>
        <h3 className="im-display im-display-lg">You two clicked</h3>
        <Squiggle className="im-matched-squiggle" />
        <p className="im-lede">
          <span aria-hidden="true">{activityMeta?.emoji ?? '⚡'}</span>{' '}
          You both wanted to {getActivityVerb(activity)}. Your chat stays open
          for 24 hours — say hi before it closes.
        </p>
      </div>

      <div className="im-matched-actions">
        {/* Always offered. A missing `chatId` is usually a momentary gap —
            the accept outran the conversation write, or this tab reconnected
            mid-match — and the handler re-asks the server rather than doing
            nothing, which is what made the button feel dead. It only reports
            a closed chat once the server confirms there is none. */}
        <button
          type="button"
          className="im-btn im-btn-yes"
          onClick={openMatchChat}
          disabled={busy}
          aria-busy={busy || undefined}
        >
          {busy ? 'Opening…' : 'Open chat'}
          {!busy && <Bolt className="im-btn-bolt" />}
        </button>
        {!chatReady && !busy && (
          <p className="im-matched-gone">
            {chat && !chat.isActive
              ? 'This chat has ended — open it to see what happened.'
              : 'Getting your chat ready — tap above if it does not open.'}
          </p>
        )}
        {/* Never leaves on the first tap: this ends the chat for both people,
            permanently. The confirmation names the other person and states
            the consequence. */}
        <button
          type="button"
          className="im-btn im-btn-ghost im-btn-sm"
          onClick={() => setConfirmLeave(true)}
          disabled={leaving}
        >
          Find someone new
        </button>
      </div>

      {confirmLeave && (
        <LeaveMatchModal
          partnerName={them.name}
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

function Portrait({ person, tilt }) {
  const [failed, setFailed] = React.useState(false);
  const resolved = React.useMemo(
    () => getProcessedAvatarUrl(person.avatar),
    [person.avatar],
  );
  const hasPhoto = Boolean(resolved) && !resolved.includes('default_avatar');

  return (
    <span className="im-matched-portrait" style={{ '--im-tilt': tilt }}>
      {hasPhoto && !failed ? (
        <img
          className="im-matched-face"
          src={resolved}
          alt=""
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="im-matched-face im-matched-face-initial" aria-hidden="true">
          {person.name.trim().charAt(0).toUpperCase()}
        </span>
      )}
    </span>
  );
}

function firstName(full) {
  if (!full || typeof full !== 'string') return '';
  return full.trim().split(/\s+/)[0];
}
