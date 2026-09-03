import { useMemo } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { postsApi } from '@shared/api/apiClient';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import { useUsersMap } from '@shared/hooks/useUsersMap';
import PostView from '../components/post/PostView';
import RightPanel from '@layout/RightPanel';
import UserSidebarCard, { UserSidebarCardSkeleton } from '@shared/components/ui/UserSidebarCard';
import NotFoundState from '@shared/components/ui/NotFoundState';

export default function PostDetailRoute() {
  const goBack = useSmartBack();
  const location = useLocation();
  const { id } = useParams();
  // getUserById was defined as exactly `users[id] || null` over this same map.
  const usersMap = useUsersMap();
  const getUserById = (id) => usersMap[id] || null;

  const handleBack = () => {
    goBack('/home');
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
  const focusComment = location.state?.focusComment;
  const hasSeed = !!(routePost && routePost.author);

  /**
   * Narrowed with `select` to just the author, because that is all this route
   * renders from the post.
   *
   * PostView subscribes to the same `['post', id]` entry — the query is shared,
   * so there is still only one request — but this route was subscribed to the
   * *whole* post object. Every write to that cache re-rendered it: liking a
   * comment, posting a reply, a poll vote, the realtime feed of another
   * viewer's activity. Each of those re-rendered PostView and the sidebar along
   * with it, for a change neither displays.
   *
   * React Query applies structural sharing to the selected value, so the object
   * below keeps its identity while the author's fields are unchanged, and this
   * component re-renders only when the author actually differs.
   */
  const { data: authorData, isError, error } = useQuery({
    queryKey: ['post', id],
    queryFn: () => postsApi.getPostById(id),
    enabled: !!id,
    retry: false,
    initialData: hasSeed ? routePost : undefined,
    initialDataUpdatedAt: hasSeed ? 0 : undefined,
    select: (p) => (p ? { author: p.author ?? null, authorId: p.authorId ?? null } : null),
  });

  // The full post still comes from the router seed; PostView reads the live
  // copy from the shared cache itself. Memoised so a cold open (no seed) does
  // not hand PostView a brand-new `{ id }` object on every render.
  const displayPost = useMemo(() => routePost || { id }, [routePost, id]);
  const hasFullData = !!(authorData && authorData.author);

  const author = authorData?.author
    || (authorData?.authorId ? getUserById(authorData.authorId) : null)
    || {
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
      <main className="centre centre--post centre--sheet">
        <PostView post={displayPost} onBack={handleBack} autoFocusComment={focusComment} />
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
