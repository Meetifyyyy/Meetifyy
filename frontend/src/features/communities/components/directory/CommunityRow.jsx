import { memo } from 'react';
import { Link } from 'react-router-dom';
import { Lock } from '@shared/components/icons';
import CommunityAvatar from './CommunityAvatar';
import JoinAction from './JoinAction';
import { activityLabel, memberLabel } from './communityMeta';
import styles from './CommunityRow.module.css';

const ROLE_LABEL = { OWNER: 'Owner', MODERATOR: 'Moderator' };

/**
 * One community in a list.
 *
 * The name is the link, stretched over the whole row, so the row is one
 * target without nesting the Join button inside another interactive element.
 *
 * `variant="mine"` shows the viewer's role and recent activity; `"explore"`
 * shows the join control.
 */
function CommunityRow({ community, variant = 'explore', from }) {
  const role = ROLE_LABEL[community.userRole];
  const activity = variant === 'mine' ? activityLabel(community) : null;
  const description = community.description && community.description !== community.name
    ? community.description
    : null;

  return (
    <article className={styles.row}>
      <CommunityAvatar community={community} size={52} />

      <div className={styles.body}>
        <div className={styles.titleLine}>
          <Link
            to={`/communities/${community.id}`}
            state={from ? { from } : undefined}
            className={styles.name}
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

        {description && <p className={styles.description}>{description}</p>}

        <p className={styles.meta}>
          <span>{memberLabel(community)}</span>
          {role && <span>{role}</span>}
          {activity && <span>{activity}</span>}
        </p>
      </div>

      {variant === 'explore' && (
        <div className={styles.action}>
          <JoinAction community={community} />
        </div>
      )}
    </article>
  );
}

export default memo(CommunityRow);
