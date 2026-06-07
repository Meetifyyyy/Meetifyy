import { useRef } from 'react';
import { useData } from '../../context/DataContext';
import Post from '../feed/Post';
import PostComposer from '../feed/PostComposer';
import { UniversityEvents, UniversityMembers } from '../layout/RightPanel';
import styles from './CommunityView.module.css';

export default function CommunityView({ communityId, onBack, onPostClick }) {
  const { posts, communities: allCommunities, users, currentUser, toggleJoinCommunity, addPost } = useData();
  const comm = allCommunities[communityId];

  if (!comm) return null;



  const userCommunities = users[currentUser?.username]?.communities || currentUser?.communities || [];
  const joined = userCommunities.includes(comm.name);
  const memberCount = comm.members;
  
  const communityPosts = posts.filter(p => p.communityId === comm.id);

  const handleToggleJoin = (e) => {
    e.stopPropagation();
    toggleJoinCommunity(communityId);
  };

  const handleCreatePostClick = () => {
    if (!joined) {
      toggleJoinCommunity(communityId);
    }
    setTimeout(() => {
      const inputEl = document.querySelector(`.${styles.commFeedIntegrated} input`);
      if (inputEl) {
        inputEl.focus();
        inputEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 150);
  };

  return (
    <div className={styles.commViewWrapper}>
      <div className={styles.commViewHeader}>
        <div className={styles.commViewBanner} style={{ background: comm.color }}></div>
        <div className={styles.commViewHeaderContent}>
          <div className={styles.commViewAvatar} style={{ background: comm.color }}>{comm.avatar}</div>
          <div className={styles.commViewInfo}>
            <h1 className={styles.commViewTitle}>{comm.name}</h1>
            <div className={styles.commViewActions}>
              <button className={styles.commCreateBtn} onClick={handleCreatePostClick}>
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
          <div className={styles.commSectionLabel}>Posts</div>
          <div className={styles.commFeedIntegrated}>
            {joined && (
              <div className={styles.commComposerWrap}>
                <PostComposer onSubmit={(text, poll) => addPost(text, poll, comm.id)} />
              </div>
            )}
            {communityPosts.length === 0 ? (
              <div className={styles.commEmptyPosts}>
                No posts in this community yet. Be the first to share something!
              </div>
            ) : (
              communityPosts.map((p) => (
                <Post key={p.id} postData={p} onClick={() => onPostClick && onPostClick(p, 'community', comm.id)} />
              ))
            )}
          </div>
        </div>

        <div className={styles.commViewSidebar}>
          {comm.isUniversity ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <UniversityEvents events={comm.events} />
              <UniversityMembers members={comm.memberList} />
            </div>
          ) : (
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
          )}
        </div>
      </div>
    </div>
  );
}
