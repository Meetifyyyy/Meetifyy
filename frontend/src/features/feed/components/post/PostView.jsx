import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { postsApi } from '@shared/api/apiClient';
import { showToast } from '@shared/utils/toast';

import Avatar from '@shared/components/avatar/Avatar';
import MentionInput from '@shared/components/mentions/MentionInput';
import Skeleton from '@shared/components/skeletons/Skeleton';
import Post from './Post';
import { CommentTreeRoot } from './CommentNode';
import styles from './PostView.module.css';
import { useData } from '@shared/hooks/useData';
import { useGlobalSocketStore } from '@stores/useGlobalSocketStore';
import { useAddComment } from '../../hooks/useAddComment';

function buildCommentTree(comments) {
  if (!comments || !Array.isArray(comments)) return [];
  const map = {};
  const roots = [];

  comments.forEach(c => {
    map[c.id] = { ...c, replies: [] };
  });

  comments.forEach(c => {
    if (c.parentId && map[c.parentId]) {
      map[c.parentId].replies.push(map[c.id]);
    } else {
      roots.push(map[c.id]);
    }
  });

  return roots;
}

// Placeholder for the post card itself while its real content is still in
// flight (only shown on a cold open — a permalink/refresh with no seed data
// from the feed click; the common "clicked from the feed" path already has
// enough to render the real card instantly).
function PostContentSkeleton() {
  return (
    <div className={styles.postSkeleton}>
      <div className={styles.postSkeletonHeader}>
        <Skeleton type="circle" width="44px" height="44px" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
          <Skeleton type="text" width="140px" height="14px" style={{ margin: 0 }} />
          <Skeleton type="text" width="90px" height="11px" style={{ margin: 0 }} />
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '1rem' }}>
        <Skeleton type="rect" width="100%" height="14px" style={{ borderRadius: '4px' }} />
        <Skeleton type="rect" width="92%" height="14px" style={{ borderRadius: '4px' }} />
        <Skeleton type="rect" width="60%" height="14px" style={{ borderRadius: '4px' }} />
      </div>
      <div style={{ display: 'flex', gap: '1.5rem', marginTop: '1.25rem' }}>
        <Skeleton type="rect" width="60px" height="28px" style={{ borderRadius: '14px' }} />
        <Skeleton type="rect" width="60px" height="28px" style={{ borderRadius: '14px' }} />
        <Skeleton type="rect" width="60px" height="28px" style={{ borderRadius: '14px' }} />
      </div>
    </div>
  );
}

function CommentsSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', padding: '0.5rem 0' }}>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} style={{ display: 'flex', gap: '0.75rem' }}>
          <Skeleton type="circle" width="32px" height="32px" style={{ flexShrink: 0 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
            <Skeleton type="text" width="100px" height="12px" style={{ margin: 0 }} />
            <Skeleton type="text" width="85%" height="10px" style={{ margin: 0 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function PostView({ post, onBack }) {
  const [replyContent, setReplyContent] = useState({ text: '', mentions: [] });
  const [loadingMore, setLoadingMore] = useState(false);
  const { currentUser } = useData();
  const { mutate: addComment } = useAddComment();
  const { socket, isConnected } = useGlobalSocketStore();
  const queryClient = useQueryClient();
  const loadMoreRef = useRef(null);

  // Seed data from a feed-card click (passed via router state, so it already
  // has author/text/media/poll) lets the query start in a "success" state
  // instead of "pending" — the shell and post content render on the very
  // first paint. `initialDataUpdatedAt: 0` marks it stale immediately so the
  // real fetch (which brings comments) still kicks off in the background.
  const hasSeedData = !!(post && post.author);

  const { data: fetchedPost, isFetching, isError: isPostError } = useQuery({
    queryKey: ['post', post?.id],
    queryFn: () => postsApi.getPostById(post.id),
    enabled: !!post?.id,
    staleTime: 30_000,
    initialData: hasSeedData ? post : undefined,
    initialDataUpdatedAt: hasSeedData ? 0 : undefined,
  });

  const livePost = isPostError ? null : (fetchedPost || post);
  const hasContent = !!(livePost && livePost.author);
  const commentsLoading = !livePost?.comments && isFetching;
  const commentsNextCursor = livePost?.commentsNextCursor;

  // Join this post's realtime room while it's open so comment/like/poll activity
  // from other viewers streams into the ['post', id] cache live; leave on unmount.
  useEffect(() => {
    const pid = post?.id;
    if (!socket || !isConnected || !pid) return;
    socket.emit('post:join', { postId: pid });
    return () => { socket.emit('post:leave', { postId: pid }); };
  }, [socket, isConnected, post?.id]);

  // Append the next page of comment threads into the SAME ['post', id] cache the
  // rest of the comment UI reads from, so optimistic add/delete/like keep working
  // untouched. Each page is a set of complete threads, so concatenating and
  // rebuilding the tree never produces orphaned replies. Deduped by id.
  const loadMoreComments = useCallback(async () => {
    const pid = post?.id;
    if (!pid) return;
    const cursor = queryClient.getQueryData(['post', pid])?.commentsNextCursor;
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await postsApi.getComments(pid, 20, cursor);
      queryClient.setQueryData(['post', pid], (old) => {
        if (!old) return old;
        const existing = old.comments || [];
        const seen = new Set(existing.map((c) => c.id));
        const merged = [...existing, ...(res.comments || []).filter((c) => !seen.has(c.id))];
        return { ...old, comments: merged, commentsNextCursor: res.nextCursor };
      });
    } catch {
      showToast('Could not load more comments.');
    } finally {
      setLoadingMore(false);
    }
  }, [post?.id, queryClient, loadingMore]);

  // Auto-load the next page when the sentinel nears the viewport (infinite
  // scroll). The sentinel is also a real button, so it still works if this view
  // lives inside a scroll container where the observer's viewport root can't see it.
  useEffect(() => {
    if (!commentsNextCursor || loadingMore) return;
    const el = loadMoreRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadMoreComments(); },
      { rootMargin: '300px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [commentsNextCursor, loadingMore, loadMoreComments]);

  // Kept above any early return so hook order never changes across renders
  // (incl. the moment `isPostError` flips true).
  useEffect(() => {
    if (!hasContent) return;
    const el = document.getElementById('reply-composer');
    if (el) el.focus();
  }, [livePost?.id, hasContent]);

  const replies = useMemo(() => {
    if (livePost?.comments) return buildCommentTree(livePost.comments);
    return livePost?.replies || [];
  }, [livePost?.comments, livePost?.replies]);

  // A confirmed error (post deleted / doesn't exist) is the caller's problem —
  // PostDetailRoute owns the dedicated "Post not found" page and swaps this
  // component out entirely on the next render once its own query sees the
  // same error via the shared cache.
  if (isPostError) return null;

  // Handles adding a reply to the main post
  const handleMainReplySubmit = (e) => {
    if (e?.preventDefault) e.preventDefault();
    if (!replyContent.text.trim() || !livePost) return;
    addComment({ postId: livePost.id, text: replyContent.text, parentId: null, mentions: replyContent.mentions, currentUser });
    setReplyContent({ text: '', mentions: [] });
  };

  // Handles adding a reply to a specific comment recursively
  const handleCommentReplySubmit = (parentId, text, mentions) => {
    if (!livePost) return;
    addComment({ postId: livePost.id, text, parentId, mentions, currentUser });
  };

  return (
    <div className={styles.postViewContainer}>

      {/* Top Bar — always renders instantly, never gated on post data */}
      <div className={styles.postViewTopbar}>
        <button onClick={onBack} className={styles.postBackBtn}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
        </button>
        <h2 className={styles.postViewTitle}>Post</h2>
      </div>

      {/* Main Post */}
      <div className={`${styles.postViewMain} comm-feed-integrated`}>
        {hasContent ? (
          <Post
            postData={livePost}
            isDetailed={true}
            onClick={() => document.getElementById('reply-composer')?.focus()}
            onDeleted={onBack}
          />
        ) : (
          <PostContentSkeleton />
        )}
      </div>

      {/* Reply Composer (Top Level) */}
      {hasContent && (
        <div className={styles.postViewComposer}>
          <Avatar src={currentUser?.avatar} name={currentUser?.displayName} size="40px" disableHover />
          <form onSubmit={handleMainReplySubmit} className={styles.replyForm}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <MentionInput
                placeholder="Post your reply..."
                value={replyContent}
                onChange={setReplyContent}
                onSubmit={handleMainReplySubmit}
                className={styles.replyTextarea}
                singleLine={false}
              />
            </div>
            <div className={styles.replyActions}>
              <button
                type="submit"
                disabled={!replyContent.text.trim()}
                className={`${styles.replyBtn} ${replyContent.text.trim() ? styles.replyBtnActive : styles.replyBtnDisabled}`}
              >
                Reply
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Replies List */}
      <div className={styles.postViewReplies}>
        {!hasContent ? null : commentsLoading ? (
          <CommentsSkeleton />
        ) : (
          <>
            <CommentTreeRoot
              postId={livePost.id}
              comments={replies}
              onReplySubmit={handleCommentReplySubmit}
            />

            {commentsNextCursor && (
              <button
                ref={loadMoreRef}
                type="button"
                onClick={loadMoreComments}
                disabled={loadingMore}
                className={styles.loadMoreComments}
              >
                {loadingMore ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" style={{ animation: 'spin 0.8s linear infinite' }} aria-hidden="true">
                    <circle cx="12" cy="12" r="10" strokeOpacity="0.2" />
                    <path d="M12 2a10 10 0 0 1 10 10" />
                  </svg>
                ) : (
                  'Load more comments'
                )}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
