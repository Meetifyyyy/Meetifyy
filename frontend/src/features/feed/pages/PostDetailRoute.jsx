import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { postsApi } from '@shared/api/apiClient';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import { useData } from '@shared/hooks/useData';
import PostView from '../components/post/PostView';
import RightPanel from '@layout/RightPanel';
import UserSidebarCard, { UserSidebarCardSkeleton } from '@shared/components/ui/UserSidebarCard';
import NotFoundState from '@shared/components/ui/NotFoundState';
import postViewStyles from '../components/post/PostView.module.css';

export default function PostDetailRoute() {
  const navigate = useNavigate();
  const goBack = useSmartBack();
  const location = useLocation();
  const { id } = useParams();
  const { getUserById } = useData();

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
      <main style={{ gridColumn: '2 / -1', width: '100%', maxWidth: 'none', margin: 0, padding: 0 }}>
        <NotFoundState
          type="post"
          message={errorMsg}
          onAction={() => goBack('/home')}
          coverPage={true}
        />
      </main>
    );
  }

  return (
    <>
      <main className="centre centre--post">
        <PostView post={displayPost} onBack={handleBack} />
      </main>
      <RightPanel>
        {hasFullData ? (
          <UserSidebarCard username={author?.username} initialUser={author} />
        ) : (
          <UserSidebarCardSkeleton />
        )}
      </RightPanel>
    </>
  );
}
