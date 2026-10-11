import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronDown, Users } from '@shared/components/icons';
import { useMyCommunities } from '@shared/hooks/useCommunities';
import CommunityAvatar from '@features/communities/components/directory/CommunityAvatar';
import styles from './CommunitiesBox.module.css';

/**
 * The collapsible "Communities" list in the desktop sidebar and the mobile
 * drawer: the viewer's own communities, then a way into /communities.
 *
 * The list is fetched only once it is opened, and shares its cache with the
 * Communities page and Home.
 */
export default function CommunitiesBox({ onItemClick, className = '' }) {
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const { myCommunities, isLoading } = useMyCommunities({ enabled: isOpen });
  const toggle = () => setIsOpen((open) => !open);

  return (
    <div className={`${styles.communitiesBox}${className ? ` ${className}` : ''}`}>
      <button
        type="button"
        className={styles.communitiesHeader}
        onClick={toggle}
        aria-expanded={isOpen}
      >
        <span>COMMUNITIES</span>
        <ChevronDown size={18} className={`${styles.chevronIcon} ${isOpen ? styles.rotated : ''}`} />
      </button>

      <div className={`${styles.communitiesListContainer} ${isOpen ? styles.open : ''}`}>
        <div className={styles.communitiesList}>
          {myCommunities.map((comm) => (
            <Link
              key={comm.id}
              to={`/communities/${comm.id}`}
              state={{ from: location.pathname }}
              className={styles.communityItem}
              onClick={onItemClick}
            >
              <CommunityAvatar community={comm} size={28} />
              <span>{comm.name}</span>
            </Link>
          ))}
          {!isLoading && myCommunities.length === 0 && (
            <div className={styles.emptyCommunities}>You haven’t joined any yet</div>
          )}

          <Link
            to={myCommunities.length > 0 ? '/communities' : '/communities?tab=explore'}
            className={styles.exploreMore}
            onClick={onItemClick}
          >
            <Users size={18} className={styles.exploreIcon} aria-hidden="true" />
            <span>{myCommunities.length > 0 ? 'All communities' : 'Explore communities'}</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
