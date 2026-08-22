import React from 'react';
import { useInstantMatch } from '../../context/InstantMatchContext';
import { useAuth } from '@shared/context/AuthContext';
import { getProcessedAvatarUrl } from '@shared/components/avatar/Avatar';
import { getActivity, getActivityVerb } from '../../constants/matchConstants';
import { Bolt, Starburst, Squiggle } from '../decor/Decor';

/**
 * Shown when the user reopens Instant Match after a mutual accept.
 *
 * The pairing is the point, so both people are given equal weight: two
 * portraits facing each other with the bolt struck between them. Coming back
 * to a blank activity grid made a successful match feel like it had never
 * happened.
 */
export default function MatchedPanel() {
  const { recentMatch, openMatchChat, dismissRecentMatch } = useInstantMatch();
  const { currentUser } = useAuth();

  if (!recentMatch) return null;

  const { candidate, activity, chatId } = recentMatch;
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
        {chatId ? (
          <button type="button" className="im-btn im-btn-yes" onClick={openMatchChat}>
            Open chat
            <Bolt className="im-btn-bolt" />
          </button>
        ) : (
          <p className="im-matched-gone">
            That chat has since closed — start a new search whenever you like.
          </p>
        )}
        <button
          type="button"
          className="im-btn im-btn-ghost im-btn-sm"
          onClick={dismissRecentMatch}
        >
          Find someone new
        </button>
      </div>
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
