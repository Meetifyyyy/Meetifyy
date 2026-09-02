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
import { useAuth } from '@shared/context/AuthContext';
import { useGlobalSocketStore } from '@stores/useGlobalSocketStore';
import { useAddComment } from '../../hooks/useAddComment';

/**
 * Flat comment list -> nested tree, reusing every node object that did not
 * actually change.
 *
 * This used to spread every comment into a brand-new object on every rebuild
 * (`{ ...c, replies: [] }`). The optimistic cache updates are careful to return
 * the *same* object for comments they did not touch — liking one comment
 * rewrites exactly one row — but this function threw that away and handed the
 * tree 60 new objects, so `React.memo` on a node could never hit and a single
 * like re-rendered the entire thread (measured: 61/61 bodies, 41ms).
 *
 * Now a node is rebuilt only when its own source row changed or its children
 * changed. Liking a root comment therefore touches one node; liking a nested
 * reply touches that reply and its ancestors, which genuinely do render a
 * different subtree. Everything else keeps its identity and its memo.
 *
 * `prevById` carries the previous rebuild's nodes in; `nextById` collects this
 * one's for the next call.
 */
const SRC = Symbol('sourceComment');

function buildCommentTree(comments, prevById, nextById) {
  if (!comments || !Array.isArray(comments)) return [];

  const byId = new Map();
  for (const c of comments) byId.set(c.id, c);

  // Child ids in list order, so sibling ordering matches the old behaviour.
  const childIds = new Map();
  const rootIds = [];
  for (const c of comments) {
    if (c.parentId && byId.has(c.parentId)) {
      const siblings = childIds.get(c.parentId);
      if (siblings) siblings.push(c.id);
      else childIds.set(c.parentId, [c.id]);
    } else {
      rootIds.push(c.id);
    }
  }

  const sameChildren = (a, b) => a.length === b.length && a.every((n, i) => n === b[i]);

  // Iterative post-order, so a thread deep enough to blow the stack cannot.
  const build = (rootId) => {
    const stack = [{ id: rootId, phase: 0 }];
    const done = new Map();
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const kidIds = childIds.get(frame.id) || [];
      if (frame.phase === 0) {
        frame.phase = 1;
        for (let i = kidIds.length - 1; i >= 0; i--) {
          if (!done.has(kidIds[i])) stack.push({ id: kidIds[i], phase: 0 });
        }
        continue;
      }
      stack.pop();
      const source = byId.get(frame.id);
      const replies = kidIds.map((id) => done.get(id));
      const prev = prevById.get(frame.id);
      let node;
      if (prev && prev[SRC] === source && sameChildren(prev.replies, replies)) {
        node = prev;
      } else {
        node = { ...source, replies };
        Object.defineProperty(node, SRC, { value: source, enumerable: false });
      }
      done.set(frame.id, node);
      nextById.set(frame.id, node);
    }
    return done.get(rootId);
  };

  return rootIds.map(build);
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
  const [isPostingComment, setIsPostingComment] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const { currentUser } = useAuth();
  const { mutateAsync: addComment } = useAddComment();
  const { socket, isConnected } = useGlobalSocketStore();
  const queryClient = useQueryClient();
  const loadMoreRef = useRef(null);
  const composerRef = useRef(null);

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
      showToast("Couldn't load comments", 'error');
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

  // There used to be an effect here that focused `#reply-composer` on open. No
  // element has ever carried that id — MentionInput renders a plain
  // contenteditable — so it had always been a no-op. Restoring it via the ref
  // would mean popping the mobile keyboard every time a post is opened, which
  // is not what anyone wants; the composer is one tap away. The tap-the-post
  // shortcut below does use the ref, and now actually works.

  // Carries the previous rebuild's nodes so unchanged subtrees keep their
  // object identity across rebuilds — see buildCommentTree.
  const treeNodesRef = useRef(new Map());

  const replies = useMemo(() => {
    if (livePost?.comments) {
      const next = new Map();
      const roots = buildCommentTree(livePost.comments, treeNodesRef.current, next);
      treeNodesRef.current = next;
      return roots;
    }
    return livePost?.replies || [];
  }, [livePost?.comments, livePost?.replies]);

  // Adding a reply to a specific comment. Returns the promise so CommentNode can
  // await it and keep its own composer open if the post fails.
  //
  // Depends on the post's *id*, not the post object. `livePost` gets a new
  // identity on every cache write — including the optimistic like of a single
  // comment — and this callback is handed to every node in the tree, so
  // depending on the object rebuilt it each time and defeated the memo on all
  // of them: liking one comment re-rendered all 61 bodies. The id is the only
  // part this actually reads.
  const postIdForReply = livePost?.id;
  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;

  const handleCommentReplySubmit = useCallback((parentId, text, mentions) => {
    if (!postIdForReply) return Promise.resolve();
    return addComment({ postId: postIdForReply, text, parentId, mentions, currentUser: currentUserRef.current });
  }, [addComment, postIdForReply]);

  // A confirmed error (post deleted / doesn't exist) is the caller's problem —
  // PostDetailRoute owns the dedicated "Post not found" page and swaps this
  // component out entirely on the next render once its own query sees the
  // same error via the shared cache.
  if (isPostError) return null;

  // Adding a top-level comment on the post.
  //
  // The composer is cleared only once the server has accepted it. It used to
  // clear synchronously right after firing the mutation, so a comment that
  // failed to post took the user's text with it and left an error toast with
  // nothing to retry from.
  const handleMainReplySubmit = async (e) => {
    if (e?.preventDefault) e.preventDefault();
    if (!replyContent.text.trim() || !livePost || isPostingComment) return;
    setIsPostingComment(true);
    try {
      await addComment({ postId: livePost.id, text: replyContent.text, parentId: null, mentions: replyContent.mentions, currentUser });
      setReplyContent({ text: '', mentions: [] });
    } catch {
      // useAddComment surfaces its own toast; the draft stays put.
    } finally {
      setIsPostingComment(false);
    }
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
            onClick={() => composerRef.current?.focus()}
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
                inputRef={composerRef}
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
                disabled={!replyContent.text.trim() || isPostingComment}
                className={`${styles.replyBtn} ${replyContent.text.trim() && !isPostingComment ? styles.replyBtnActive : styles.replyBtnDisabled}`}
              >
                {isPostingComment ? 'Posting…' : 'Reply'}
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
