import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { useSmartBack } from '../hooks/useSmartBack';
import { useData } from '../context/DataContext';
import { useFollow } from '../context/FollowContext';
import { EmptyState } from '../components/common/StateViews';
import PostView from '../components/feed/PostView';
import RightPanel from '../components/layout/RightPanel';
import rightPanelStyles from '../components/layout/RightPanel.module.css';
import { isImageUrl } from '../utils/avatar';
import DefaultAvatar from '../components/common/DefaultAvatar';

export default function PostDetailRoute() {
  const navigate = useNavigate();
  const goBack = useSmartBack();
  const location = useLocation();
  const { id } = useParams();
  const { getUserById, getPostById, communities, currentUser } = useData();
  const { isFollowing, toggleFollow } = useFollow();

  const handleBack = () => {
    goBack('/home');
  };

  // Always prefer live state from DataContext; use location.state only for context hints
  const post = getPostById(id) || location.state?.post || null;

  const sourceContext = location.state?.sourceContext || (post?.communityId ? 'community' : 'feed');
  const communityId = location.state?.communityId || post?.communityId;

  // Only show empty state if we truly have no post data at all (e.g. direct URL navigation to invalid ID)
  if (!post) {
    return (
      <main className="centre">
        <EmptyState 
          title="Post not found" 
          message="This post may have been removed or the link is incorrect."
          icon={
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-light)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '1rem' }}>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          }
        />
        <div style={{ textAlign: 'center' }}>
          <button
            onClick={() => goBack('/home')}
            style={{
              marginTop: '0.5rem',
              padding: '0.6rem 1.5rem',
              background: 'var(--color-primary)',
              color: 'white',
              border: 'none',
              borderRadius: 'var(--radius-full)',
              cursor: 'pointer',
              fontFamily: 'var(--font-family-sans)',
              fontWeight: 600,
              fontSize: '0.9rem'
            }}
          >
            Back to home
          </button>
        </div>
      </main>
    );
  }

  const renderRightPanel = () => {
    if (sourceContext === 'community' && communityId) {
      const comm = communities[communityId];
      if (!comm) return null;

      return (
        <RightPanel>
          <div className={rightPanelStyles.panelCard}>
            <h3 className={rightPanelStyles.panelTitle}>About Community</h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--color-text-main)', marginBottom: '1.5rem', lineHeight: '1.5' }}>{comm.desc}</p>

            <div style={{ display: 'flex', gap: '2rem', marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontFamily: 'var(--font-family-display)', fontSize: '1.15rem', fontWeight: 700, color: 'var(--color-text-main)' }}>{comm.members?.toLocaleString() || '0'}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Members</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontFamily: 'var(--font-family-display)', fontSize: '1.15rem', fontWeight: 700, color: 'var(--color-text-main)' }}>
                  <span style={{ display: 'inline-block', marginRight: '6px', width: '8px', height: '8px', borderRadius: '50%', background: 'var(--color-success)' }}></span>
                  {Math.floor((comm.members || 0) * 0.12).toLocaleString()}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Online</div>
              </div>
            </div>

            <div style={{ paddingTop: '1.2rem', borderTop: '1px solid var(--color-border-light)', marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--color-text-muted)', fontWeight: 500 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              Created {comm.created}
            </div>
          </div>
        </RightPanel>
      );
    } else {
      const author = getUserById(post.authorId) || {
        displayName: 'Unknown User',
        followers: 0,
        following: 0,
        communities: []
      };

      const isSelf = currentUser && author.id === currentUser.id;
      const isFollowingUser = isFollowing(author.username);

      return (
        <RightPanel>
          <div className={rightPanelStyles.panelCard} style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
            {/* Profile Info */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Avatar */}
              <div 
                style={{ width: '80px', height: '80px', borderRadius: '50%', overflow: 'hidden', background: 'var(--color-bg-main)', cursor: 'pointer' }}
                onClick={() => navigate(`/profile/${author.username || author.displayName?.toLowerCase().replace(/\s+/g, '')}`)}
              >
                {isImageUrl(author.avatarUrl || author.avatar) ? (
                  <img src={author.avatarUrl || author.avatar} alt={author.displayName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <DefaultAvatar size={80} />
                )}
              </div>
              
              <div 
                style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', cursor: 'pointer' }}
                onClick={() => navigate(`/profile/${author.username || author.displayName?.toLowerCase().replace(/\s+/g, '')}`)}
              >
                <h2 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--color-text-main)', fontFamily: 'var(--font-family-display)' }}>{author.displayName}</h2>
                <div style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>@{author.username || author.displayName?.toLowerCase().replace(/\s+/g, '')}</div>
              </div>

              {/* Description */}
              <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--color-text-main)', lineHeight: '1.5' }}>
                {author.bio || author.desc || 'Passionate about coding, design, and building communities. Always learning something new.'}
              </p>

              {/* Action Buttons */}
              {!isSelf && (
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button 
                    onClick={() => toggleFollow(author.username)}
                    style={{ 
                      flex: 1, 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center', 
                      gap: '0.5rem', 
                      padding: '0.65rem', 
                      borderRadius: 'var(--radius-full)', 
                      border: 'none', 
                      background: isFollowingUser ? 'rgba(var(--color-primary-rgb), 0.15)' : 'var(--color-primary)', 
                      color: isFollowingUser ? 'var(--color-primary)' : '#FFFFFF', 
                      fontWeight: 600, 
                      cursor: 'pointer', 
                      fontFamily: 'var(--font-family-sans)', 
                      transition: 'all 0.2s' 
                    }}
                  >
                    {isFollowingUser ? (
                      <>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        Following
                      </>
                    ) : (
                      <>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        Follow
                      </>
                    )}
                  </button>
                </div>
              )}

              {/* Stats */}
              <div style={{ display: 'flex', gap: '2.5rem', paddingBottom: '1.5rem', borderBottom: '1px solid var(--color-border-light)' }}>
                <div>
                  <div style={{ fontWeight: 800, color: 'var(--color-text-main)', fontSize: '1.15rem' }}>{author.followers?.toLocaleString?.() ?? 0}</div>
                  <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', fontWeight: 500 }}>Followers</div>
                </div>
                <div>
                  <div style={{ fontWeight: 800, color: 'var(--color-text-main)', fontSize: '1.15rem' }}>{author.following?.toLocaleString?.() ?? 0}</div>
                  <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', fontWeight: 500 }}>Following</div>
                </div>
              </div>

              {/* Communities */}
              <div>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem' }}>Member of</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {author.communities && author.communities.length > 0 ? author.communities.map((commName, i) => {
                    const commEntry = Object.entries(communities).find(([_, c]) => c.name === commName);
                    const commId = commEntry ? commEntry[0] : null;
                    return (
                    <div 
                      key={i} 
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: commId ? 'pointer' : 'default' }}
                      onClick={() => commId && navigate(`/communities/${commId}`)}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: 'linear-gradient(135deg, #22C55E, #10B981)', display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#FFFFFF', fontSize: '0.8rem', fontWeight: 700 }}>
                          {commName.charAt(0)}
                        </div>
                        <div>
                          <div style={{ fontWeight: 700, color: 'var(--color-text-main)', fontSize: '0.85rem' }}>{commName}</div>
                          <div style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>Member</div>
                        </div>
                      </div>
                      <button style={{ background: 'var(--color-border-light)', color: 'var(--color-text-muted)', border: 'none', borderRadius: 'var(--radius-full)', padding: '0.25rem 0.6rem', fontSize: '0.75rem', fontWeight: 600, cursor: 'default' }}>Joined</button>
                    </div>
                    );
                  }) : (
                    <div style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>No communities yet.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </RightPanel>
      );
    }
  };

  return (
    <>
      <main className="centre">
        <PostView post={post} onBack={handleBack} />
      </main>
      {renderRightPanel()}
    </>
  );
}
