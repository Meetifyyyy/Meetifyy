import { useState } from 'react';
import { useData } from '../../context/DataContext';
import { communities } from '../../data/communities';
import Post from '../feed/Post';
import styles from './CommunityView.module.css';

export default function CommunityView({ communityId, onBack, onPostClick }) {
  const { posts } = useData();
  const comm = communities[communityId];
  const [joined, setJoined] = useState(false);
  const [memberCount, setMemberCount] = useState(comm?.members || 0);

  if (!comm) return null;

  const handleToggleJoin = (e) => {
    e.stopPropagation();
    if (joined) {
      setJoined(false);
      setMemberCount(memberCount - 1);
    } else {
      setJoined(true);
      setMemberCount(memberCount + 1);
    }
  };
  
  const communityPosts = posts.filter(p => p.communityId === comm.id);

  return (
    <div className={styles.commViewWrapper}>
      <div className={styles.commViewHeader} style={{ margin: '0 1.5rem 1.5rem' }}>
        <div className={styles.commViewBanner} style={{ background: comm.color }}></div>
        <div className={styles.commViewHeaderContent}>
          <div className={styles.commViewAvatar} style={{ background: comm.color }}>{comm.avatar}</div>
          <div className={styles.commViewInfo}>
            <h1 className={styles.commViewTitle}>{comm.name}</h1>
            <div className={styles.commViewActions}>
              <button className={styles.commCreateBtn}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                Create Post
              </button>
              <button
                className={`${styles.commJoinBtn}${joined ? ` ${styles.joined}` : ''}`}
                onClick={handleToggleJoin}
              >
                {joined ? (
                  <>Joined</>
                ) : (
                  <>Join</>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.commViewMain}>
        <div className={styles.commViewLeftBox}>
          <div className={styles.commSectionLabel} style={{ padding: '0 1.5rem', marginTop: '1.5rem' }}>Posts</div>
          <div className={styles.commFeedIntegrated} style={{ paddingBottom: '0' }}>
            {communityPosts.map((p) => (
              <Post key={p.id} postData={p} onClick={() => onPostClick && onPostClick(p, 'community', comm.id)} />
            ))}
          </div>
        </div>

        <div className={styles.commViewSidebar}>
          <div className={styles.commAboutCard}>
            <h3 className={styles.panelTitle}>About Community</h3>
            <p className={styles.commCardDesc}>{comm.desc}</p>
            
            <div className={styles.commAboutStats}>
              <div className={styles.commAboutStat}>
                <div className={styles.statValue}>{memberCount.toLocaleString()}</div>
                <div className={styles.statLabel}>Members</div>
              </div>
              <div className={styles.commAboutStat}>
                <div className={styles.statValue}><span className={styles.onlineDot} style={{ marginRight: '6px' }}></span>{Math.floor(memberCount * 0.12).toLocaleString()}</div>
                <div className={styles.statLabel}>Online</div>
              </div>
            </div>

            <div className={styles.commCardCreated} style={{ paddingTop: '1.2rem', borderTop: '1px solid rgba(24, 24, 27, 0.05)', marginTop: '0.5rem' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              Created {comm.created}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
