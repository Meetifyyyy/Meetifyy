import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useSmartNavigation } from '@shared/hooks/useSmartNavigation';
import { useJoinedCommunities } from '@shared/hooks/useCommunities';
import { isImageUrl } from '@shared/utils/avatar';
import { getMediaUrl } from '@shared/api/apiClient';
import {
  ChevronDownIcon,
  UserGroupIcon as CommunitiesOutline,
} from '@heroicons/react/24/outline';
import styles from './CommunitiesBox.module.css';

function CommunityItem({ comm, onClick }) {
  const [imgError, setImgError] = useState(false);
  const isImage = isImageUrl(comm.avatar);
  const avatarSrc = isImage ? getMediaUrl(comm.avatar) : '';

  return (
    <a
      href="#"
      className={styles.communityItem}
      onClick={onClick}
    >
      <div 
        className={styles.communityAvatar}
        style={{ background: (!isImage || imgError) ? (comm.color || 'var(--color-primary)') : 'var(--color-bg-white)' }}
      >
        {isImage && !imgError ? (
          <img
            src={avatarSrc}
            alt={comm.name}
            width="100%"
            height="100%"
            style={{ objectFit: 'cover', display: 'block' }}
            onError={() => setImgError(true)}
          />
        ) : (
          <span style={{ color: '#FFFFFF', fontWeight: 700 }}>
            {comm.avatar || (comm.name ? comm.name.charAt(0).toUpperCase() : '')}
          </span>
        )}
      </div>
      <span>{comm.name}</span>
    </a>
  );
}

export default function CommunitiesBox({ onItemClick, className = '' }) {
  const { smartNavigate: navigate } = useSmartNavigation();
  const location = useLocation();
  const [isCommunitiesMenuOpen, setIsCommunitiesMenuOpen] = useState(false);
  const joinedCommunityObjects = useJoinedCommunities();

  const handleCommunityClick = (commId) => (e) => {
    e.preventDefault();
    navigate(`/communities/${commId}`, { state: { from: location.pathname } });
    onItemClick?.();
  };

  const handleExploreClick = (e) => {
    e.preventDefault();
    navigate('/communities');
    onItemClick?.();
  };

  return (
    <div className={`${styles.communitiesBox}${className ? ` ${className}` : ''}`}>
      <div 
        className={styles.communitiesHeader} 
        onClick={() => setIsCommunitiesMenuOpen(!isCommunitiesMenuOpen)}
        role="button"
        tabIndex={0}
        aria-expanded={isCommunitiesMenuOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsCommunitiesMenuOpen(!isCommunitiesMenuOpen);
          }
        }}
      >
        <span>COMMUNITIES</span>
        <ChevronDownIcon className={`${styles.chevronIcon} ${isCommunitiesMenuOpen ? styles.rotated : ''}`} />
      </div>
      
      <div className={`${styles.communitiesListContainer} ${isCommunitiesMenuOpen ? styles.open : ''}`}>
        <div className={styles.communitiesList}>
          {joinedCommunityObjects.length > 0 ? (
            joinedCommunityObjects.map((comm) => (
              <CommunityItem
                key={comm.id}
                comm={comm}
                onClick={handleCommunityClick(comm.id)}
              />
            ))
          ) : (
            <div className={styles.emptyCommunities}>
              No communities joined yet
            </div>
          )}
          
          <a
            href="#"
            className={styles.exploreMore}
            onClick={handleExploreClick}
          >
            <CommunitiesOutline className={styles.exploreIcon} />
            <span>Explore more...</span>
          </a>
        </div>
      </div>
    </div>
  );
}
