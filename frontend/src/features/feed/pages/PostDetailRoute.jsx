import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { postsApi } from '@shared/api/apiClient';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import { useData } from '@shared/hooks/useData';
import PostView from '../components/post/PostView';
import RightPanel, { OnlineFriends } from '@layout/RightPanel';
import rightPanelStyles from '@layout/RightPanel.module.css';
import UserSidebarCard, { UserSidebarCardSkeleton } from '@shared/components/ui/UserSidebarCard';
import postViewStyles from '../components/post/PostView.module.css';

export default function PostDetailRoute() {
  const navigate = useNavigate();
  const goBack = useSmartBack();
  const location = useLocation();
  const { id } = useParams();
  const { getUserById, communities } = useData();

  const handleBack = () => {
    navigate(location.state?.from ?? '/home', { replace: true });
  };

  // A post opened from the feed already carries its full card data via router
  // state — seed the query with it so this route starts in a "success" state
  // instead of "pending": the header/back button/post content render on the
  // very first paint instead of waiting on a round-trip. `initialDataUpdatedAt:
  // 0` marks that seed stale immediately so the real fetch (bringing comments)
  // still runs in the background. A cold open (permalink/refresh) has no seed
  // and simply falls through to the normal loading path, handled inside
  // PostView (structural shell first, skeleton for the dynamic content).
  const routePost = location.state?.post;
  const hasSeed = !!(routePost && routePost.author);

  const { data: fetchedPost, isError, error } = useQuery({
    queryKey: ['post', id],
    queryFn: () => postsApi.getPostById(id),
    enabled: !!id,
    retry: false,
    initialData: hasSeed ? routePost : undefined,
    initialDataUpdatedAt: hasSeed ? 0 : undefined,
  });

  const post = isError ? null : fetchedPost;
  const displayPost = post || (routePost || { id });
  const hasFullData = !!(post && post.author);

  const author = post?.author || (post?.authorId ? getUserById(post.authorId) : null) || {
    displayName: 'Unknown User',
    username: 'unknown',
    followers: 0,
    following: 0,
    communities: []
  };

  if (isError) {
    const errorMsg = error?.response?.data?.message || 'This post may have been removed or deleted.';
    return (
      <main className="centre centre--post" style={{ gridColumn: '2 / -1', maxWidth: '780px', margin: '0 auto', width: '100%' }}>
        <div className={postViewStyles.postViewContainer} style={{ minHeight: 'calc(100vh - 120px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ padding: '3rem 2rem', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%', maxWidth: '440px' }}>
            <div style={{
              width: '72px',
              height: '72px',
              borderRadius: '50%',
              background: 'rgba(239, 68, 68, 0.08)',
              color: '#ef4444',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '1.5rem'
            }}>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            </div>
            <h2 style={{ fontFamily: 'var(--font-family-display)', fontSize: '1.5rem', fontWeight: 700, margin: '0 0 0.6rem 0', color: 'var(--color-text-main)' }}>
              Post not found
            </h2>
            <p style={{ fontFamily: 'var(--font-family-sans)', fontSize: '0.95rem', color: 'var(--color-text-muted)', margin: '0 0 2rem 0', maxWidth: '380px', lineHeight: 1.5 }}>
              {errorMsg}
            </p>
            <button
              onClick={() => goBack('/home')}
              style={{
                padding: '0.8rem 1.8rem',
                background: 'var(--color-primary)',
                color: 'white',
                border: 'none',
                borderRadius: '100px',
                cursor: 'pointer',
                fontFamily: 'var(--font-family-sans)',
                fontWeight: 600,
                fontSize: '0.95rem',
                boxShadow: 'var(--shadow-sm)'
              }}
            >
              Back to Home Feed
            </button>
          </div>
        </div>
      </main>
    );
  }

  const sourceContext = location.state?.sourceContext || (post?.communityId ? 'community' : 'feed');
  const communityId = location.state?.communityId || post?.communityId;

  const renderRightPanel = () => {
    const comm = (sourceContext === 'community' && communityId)
      ? (communities?.[communityId] || (Array.isArray(communities) ? communities.find(c => c.id === communityId || c.name === communityId) : null) || (Object.values(communities || {}).find(c => c?.id === communityId)))
      : null;

    return (
      <RightPanel>
        {comm ? (
          <div className={rightPanelStyles.panelCard}>
            <h3 className={rightPanelStyles.panelTitle}>About Community</h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--color-text-main)', marginBottom: '1.5rem', lineHeight: '1.5' }}>{comm.desc || comm.description || 'Welcome to the community!'}</p>

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

            {comm.created && (
              <div style={{ paddingTop: '1.2rem', borderTop: '1px solid var(--color-border-light)', marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--color-text-muted)', fontWeight: 500 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                Created {comm.created}
              </div>
            )}
          </div>
        ) : (
          <UserSidebarCard username={author?.username} initialUser={author} />
        )}
        <OnlineFriends />
      </RightPanel>
    );
  };

  return (
    <>
      <main className="centre centre--post">
        <PostView post={displayPost} onBack={handleBack} />
      </main>
      {hasFullData ? renderRightPanel() : (
        <RightPanel>
          <UserSidebarCardSkeleton />
          <OnlineFriends />
        </RightPanel>
      )}
    </>
  );
}
