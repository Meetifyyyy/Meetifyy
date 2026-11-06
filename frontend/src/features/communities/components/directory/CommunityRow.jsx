import { memo } from 'react';
import { Link } from 'react-router-dom';
import { Lock } from '@shared/components/icons';
import { useAuth } from '@shared/context/AuthContext';
import { usePageTransition } from '@shared/hooks/usePageTransition';
import { CENTRE_EFFECT } from '@shared/lib/navigation/centreTransition';
import { isCommunityMember, isCommunityOwner } from '@shared/utils/community';
import CommunityAvatar from './CommunityAvatar';
import JoinAction from './JoinAction';
import { memberLabel } from './communityMeta';
import { toSummaryText } from '@shared/utils/communityText';
import styles from './CommunityRow.module.css';

const ROLE_LABEL = { OWNER: 'Owner', MODERATOR: 'Moderator' };

/**
 * One community in a list.
 *
 * The name is the link, stretched over the whole row, so the row is one
 * target without nesting the Join button inside another interactive element.
 *
 * Shows the join control. `showMembership={false}` (the Communities and Campus
 * Communities pages) drops what only restates membership - the role line and
 * the settled "Owner" / "Joined" chip - so a joined community shows no action.
 *
 * `highlightOnHover` is for the Campus surfaces: on a mouse the card lifts and
 * takes the primary border, as an activity card does.
 */
function CommunityRow({ community, from, showMembership = true, highlightOnHover = false }) {
  const { currentUser } = useAuth();
  const { openFromLink } = usePageTransition({ effect: CENTRE_EFFECT });
  const role = showMembership ? ROLE_LABEL[community.userRole] : null;
  const joined = isCommunityOwner(community, currentUser) || isCommunityMember(community, currentUser);
  const showAction = showMembership || !joined;
  const description = community.description && community.description !== community.name
    ? community.description
    : null;

  return (
    <article className={highlightOnHover ? `${styles.row} ${styles.highlight}` : styles.row}>
      {/* Icon, then name over member count, then Join: one line. The name
          gives way (ellipsis) before the button does. The description runs
          under all three, across the card's full width. */}
      <div className={styles.head}>
        <CommunityAvatar community={community} size={52} />

        <div className={styles.titles}>
          <div className={styles.titleLine}>
            <Link
              to={`/communities/${community.id}`}
              state={from ? { from } : undefined}
              className={styles.name}
              onClick={(e) => openFromLink(e, `/communities/${community.id}`, from ? { state: { from } } : undefined)}
            >
              {community.name}
            </Link>
            {community.isPrivate && (
              <span className={styles.privateTag}>
                <Lock size={12} strokeWidth={2} aria-hidden="true" />
                Private
              </span>
            )}
          </div>
          <p className={styles.meta}>
            <span>{memberLabel(community)}</span>
            {role && <span>{role}</span>}
          </p>
        </div>

        {showAction && (
          <div className={styles.action}>
            <JoinAction community={community} />
          </div>
        )}
      </div>

      {description && <p className={styles.description}>{toSummaryText(description)}</p>}
    </article>
  );
}

export default memo(CommunityRow);
