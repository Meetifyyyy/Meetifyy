import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { useData } from '../context/DataContext';
import PostView from '../components/feed/PostView';
import RightPanel from '../components/layout/RightPanel';
import { communities } from '../data/communities';
import rightPanelStyles from '../components/layout/RightPanel.module.css';

export default function PostDetailRoute() {
  const navigate = useNavigate();
  const location = useLocation();
  const { getUserById } = useData();

  // Retrieve post data passed from navigation state. 
  // In a real app, if state is missing (e.g. direct URL hit), you'd fetch it using the id.
  const activePost = location.state; 

  const handleBack = () => {
    navigate(-1);
  };

  if (!activePost || !activePost.post) {
    return (
      <main className="centre">
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <h3>Post not found</h3>
          <button onClick={() => navigate('/home')} style={{ marginTop: '1rem', padding: '0.5rem 1rem', background: 'var(--color-primary)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            Go Home
          </button>
        </div>
      </main>
    );
  }

  const post = activePost.post;
  const sourceContext = activePost.sourceContext;
  const communityId = activePost.communityId;

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
                <div style={{ fontFamily: 'var(--font-family-display)', fontSize: '1.15rem', fontWeight: 700, color: 'var(--color-text-main)' }}>{comm.members.toLocaleString()}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Members</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontFamily: 'var(--font-family-display)', fontSize: '1.15rem', fontWeight: 700, color: 'var(--color-text-main)' }}><span style={{ display: 'inline-block', marginRight: '6px', width: '8px', height: '8px', borderRadius: '50%', background: '#22C55E' }}></span>{Math.floor(comm.members * 0.12).toLocaleString()}</div>
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

      return (
        <RightPanel>
            <div className={rightPanelStyles.panelCard} style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {/* Banner */}
              <div style={{ height: '140px', background: 'linear-gradient(135deg, rgba(109, 93, 252, 0.15), rgba(168, 85, 247, 0.15))', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'url("data:image/svg+xml,%3Csvg width=\\\'20\\\' height=\\\'20\\\' viewBox=\\\'0 0 20 20\\\' xmlns=\\\'http://www.w3.org/2000/svg\\\'%3E%3Cg fill=\\\'%236d5dfc\\\' fill-opacity=\\\'0.05\\\' fill-rule=\\\'evenodd\\\'%3E%3Ccircle cx=\\\'3\\\' cy=\\\'3\\\' r=\\\'3\\\'/%3E%3Ccircle cx=\\\'13\\\' cy=\\\'13\\\' r=\\\'3\\\'/%3E%3C/g%3E%3C/svg%3E")' }}></div>
              </div>

              {/* Content */}
              <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                {/* Header & Options */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ margin: 0, fontSize: '1.25rem', color: '#18181B', fontFamily: "'Outfit', sans-serif" }}>{author.displayName}</h3>
                  <button style={{ background: 'rgba(24, 24, 27, 0.05)', border: 'none', borderRadius: '50%', width: '32px', height: '32px', display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: 'pointer', transition: 'background 0.2s' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#71717A" strokeWidth="2.5"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
                  </button>
                </div>
                
                {/* Action Buttons */}
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '0.65rem', borderRadius: '100px', border: 'none', background: '#6D5DFC', color: '#fff', fontWeight: 600, cursor: 'pointer', fontFamily: "'Manrope', sans-serif", transition: 'opacity 0.2s' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                      Follow
                  </button>
                  <button style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '0.65rem', borderRadius: '100px', border: 'none', background: 'rgba(24, 24, 27, 0.06)', color: '#18181B', fontWeight: 600, cursor: 'pointer', fontFamily: "'Manrope', sans-serif", transition: 'background 0.2s' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                      Message
                  </button>
                </div>

                {/* Stats */}
                <div style={{ display: 'flex', gap: '2.5rem', paddingBottom: '1.5rem', borderBottom: '1px solid rgba(24, 24, 27, 0.05)' }}>
                    <div>
                      <div style={{ fontWeight: 800, color: '#18181B', fontSize: '1.15rem' }}>{author.followers.toLocaleString()}</div>
                      <div style={{ color: '#71717A', fontSize: '0.85rem', fontWeight: 500 }}>Followers</div>
                    </div>
                    <div>
                      <div style={{ fontWeight: 800, color: '#18181B', fontSize: '1.15rem' }}>{author.following.toLocaleString()}</div>
                      <div style={{ color: '#71717A', fontSize: '0.85rem', fontWeight: 500 }}>Following</div>
                    </div>
                </div>
                
                {/* Communities */}
                <div>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#71717A', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '1.25rem' }}>Member of these communities</div>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                      {author.communities && author.communities.length > 0 ? author.communities.map((commName, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                              <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'linear-gradient(135deg, #22C55E, #10B981)', display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#fff', fontSize: '0.9rem', fontWeight: 700 }}>
                                {commName.charAt(0)}
                              </div>
                              <div>
                                <div style={{ fontWeight: 700, color: '#18181B', fontSize: '0.95rem' }}>{commName}</div>
                                <div style={{ color: '#71717A', fontSize: '0.8rem' }}>Member</div>
                              </div>
                          </div>
                          <button style={{ background: 'rgba(24, 24, 27, 0.05)', color: '#71717A', border: 'none', borderRadius: '100px', padding: '0.4rem 1rem', fontSize: '0.85rem', fontWeight: 600, cursor: 'default' }}>Joined</button>
                        </div>
                      )) : (
                        <div style={{ color: '#71717A', fontSize: '0.85rem' }}>No communities yet.</div>
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
