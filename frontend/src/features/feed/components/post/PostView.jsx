import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { postsApi } from '@shared/api/apiClient';
import { showToast } from '@shared/utils/toast';

import Skeleton from '@shared/components/skeletons/Skeleton';
import Post from './Post';
import ReplyDock from './ReplyDock';
import { KEYBOARD_OVERLAYS_PAGE } from '@shared/utils/keyboardOverlay';
import { CommentTreeRoot } from './CommentNode';
import styles from './PostView.module.css';
import { useAuth } from '@shared/context/AuthContext';
import { useGlobalSocketStore } from '@stores/useGlobalSocketStore';
import { useAddComment } from '../../hooks/useAddComment';
import { useMediaQuery } from '@shared/hooks/useMediaQuery';
import { getCommentLimitState, COMMENT_MAX_CHARS } from '@shared/utils/textLimit';
import { useComposerDraft } from '@shared/hooks/useComposerDraft';
import { draftOwner, saveDraft } from '@shared/lib/drafts';

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
      {/* The action row is static chrome: reserve its height, draw nothing. */}
      <div style={{ height: '28px', marginTop: '1.25rem' }} />
    </div>
  );
}

/**
 * Placeholder for the comment list: the shape of a real comment row (the same
 * 40px avatar and 8px gap, a name · handle · time line, then the text), three
 * of them, and nothing else. Line widths differ so it reads as comments rather
 * than a pattern. Sizes mirror `.treeRoot` in CommentNode.module.css.
 */
const COMMENT_SKELETON_ROWS = [
  { name: '84px', handle: '64px', lines: ['92%', '58%'] },
  { name: '104px', handle: '72px', lines: ['74%'] },
  { name: '68px', handle: '56px', lines: ['96%', '81%'] },
];

function CommentsSkeleton() {
  return (
    <div className={styles.commentsSkeleton} aria-hidden="true">
      {COMMENT_SKELETON_ROWS.map((row, i) => (
        <div key={i} className={styles.commentSkeletonRow}>
          <Skeleton type="circle" width="40px" height="40px" />
          <div className={styles.commentSkeletonBody}>
            <div className={styles.commentSkeletonHead}>
              <Skeleton type="rect" width={row.name} height="12px" style={{ borderRadius: '4px' }} />
              <Skeleton type="rect" width={row.handle} height="10px" style={{ borderRadius: '4px' }} />
              <Skeleton type="rect" width="22px" height="10px" style={{ borderRadius: '4px' }} />
            </div>
            {row.lines.map((w, j) => (
              <Skeleton key={j} type="rect" width={w} height="12px" style={{ borderRadius: '4px' }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function PostView({ post, onBack, autoFocusComment = false }) {
  const location = useLocation();
  const shouldFocusComment = Boolean(
    autoFocusComment ||
    location?.state?.focusComment ||
    location?.hash === '#reply' ||
    location?.hash === '#comments' ||
    location?.hash === '#comment'
  );

  // Wide screens get a composer under the post; phones keep the docked bar.
  // Same boundary as the stylesheet's 768px breakpoint.
  const isWide = useMediaQuery('(min-width: 769px)') === true;
  // One persistent draft per post, whoever it is addressed to. The reply
  // target is deliberately not part of the key: it is a tag on this page's
  // single composer (and the comment it names may not even be loaded after a
  // restart), so a per-parent key would only scatter one half-written thought
  // across several slots the person has to remember. The text comes back; they
  // pick the target again if they still want one.
  // Whether this view is still on screen, for work that finishes after it.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const [replyContent, setReplyContent] = useComposerDraft(
    post?.id ? `comment:${post.id}` : null,
    { maxLength: COMMENT_MAX_CHARS },
  );
  // The comment being answered, if any: { id, username }. Replies are written
  // in this page's one composer, which shows the target as a tag.
  const [replyTarget, setReplyTarget] = useState(null);
  const [isPostingComment, setIsPostingComment] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const { currentUser } = useAuth();
  const { mutateAsync: addComment } = useAddComment();
  const socket = useGlobalSocketStore((s) => s.socket);
  const isConnected = useGlobalSocketStore((s) => s.isConnected);
  const queryClient = useQueryClient();
  const loadMoreRef = useRef(null);
  const composerRef = useRef(null);
  const columnRef = useRef(null);
  const hasAutoFocusedRef = useRef(false);

  // The reply bar's field is always there (see ReplyDock): "open the composer"
  // is just "put the caret in it". `preventScroll`: the bar is docked and rises
  // with the keyboard by itself, so the page under it must not move.
  const focusComposer = useCallback(() => {
    composerRef.current?.focus({ preventScroll: true });
  }, []);

  // Commenting on the post itself drops any reply target.
  const focusPostComposer = useCallback(() => {
    setReplyTarget(null);
    focusComposer();
  }, [focusComposer]);

  // "Reply" on a comment: tag the composer with it and put the caret there.
  const handleReplyRequest = useCallback((target) => {
    setReplyTarget(target);
    focusComposer();
  }, [focusComposer]);

  const cancelReply = useCallback(() => setReplyTarget(null), []);

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

  // Focus comment composer if opened with comment intent
  useEffect(() => {
    if (shouldFocusComment && hasContent && !hasAutoFocusedRef.current) {
      hasAutoFocusedRef.current = true;
      const timer = setTimeout(() => {
        focusComposer();
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [shouldFocusComment, hasContent, focusComposer]);

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

  // A confirmed error (post deleted / doesn't exist) is the caller's problem —
  // PostDetailRoute owns the dedicated "Post not found" page and swaps this
  // component out entirely on the next render once its own query sees the
  // same error via the shared cache.
  if (isPostError) return null;

  // Adding a comment: on the post, or — with a reply target — under that comment.
  //
  // The comment appears in the list at once (useAddComment's optimistic row),
  // so the composer clears at once too. Waiting for the server left the text
  // sitting in the box under a comment that was already showing. If the post
  // fails, the optimistic row is rolled back and the draft is put back — unless
  // the user has started typing something else in the meantime.
  const handleMainReplySubmit = async (e) => {
    if (e?.preventDefault) e.preventDefault();
    if (!replyContent.text.trim() || !livePost || isPostingComment) return;
    // The composer disables Send past the limit; this is the same check for any
    // other way in (a keyboard submit, a pasted draft restored after an error).
    if (getCommentLimitState(replyContent.text).isOver) return;
    const draft = replyContent;
    const target = replyTarget;
    const draftScopeAtSubmit = `comment:${livePost.id}`;
    const typedBy = draftOwner();
    setIsPostingComment(true);
    setReplyContent({ text: '', mentions: [] });
    setReplyTarget(null);
    // Posted: the bar goes back to its resting state and the keyboard drops.
    composerRef.current?.blur();
    try {
      await addComment({ postId: livePost.id, text: draft.text, parentId: target?.id ?? null, mentions: draft.mentions, currentUser });
    } catch {
      // useAddComment surfaces its own toast; the draft comes back to retry.
      setReplyContent((cur) => (cur.text.trim() ? cur : draft));
      setReplyTarget((cur) => cur ?? target);
      // Left the post while it was sending: the state above goes nowhere, and
      // the box was cleared (deleting the stored draft) the moment it was sent,
      // so keep the text as this post's draft for the next visit.
      if (!mountedRef.current) {
        saveDraft(draftScopeAtSubmit, draft.text, {
          mentions: draft.mentions,
          maxLength: COMMENT_MAX_CHARS,
          owner: typedBy,
        });
      }
    } finally {
      setIsPostingComment(false);
    }
  };

  return (
    <div
      ref={columnRef}
      className={styles.postViewContainer}
      data-keyboard-overlay={KEYBOARD_OVERLAYS_PAGE && !isWide ? '' : undefined}
    >

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
            onClick={focusPostComposer}
            onCommentClick={focusPostComposer}
            onDeleted={onBack}
          />
        ) : (
          <PostContentSkeleton />
        )}
      </div>

      {/* Wide screens: the composer is part of the page, right under the post. */}
      {hasContent && isWide && (
        <ReplyDock
          inline
          currentUser={currentUser}
          value={replyContent}
          onChange={setReplyContent}
          onSubmit={handleMainReplySubmit}
          isPosting={isPostingComment}
          inputRef={composerRef}
          columnRef={columnRef}
          replyingTo={replyTarget?.username ?? null}
          onCancelReply={cancelReply}
        />
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
              onReplyRequest={handleReplyRequest}
              replyTargetId={replyTarget?.id ?? null}
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
      {hasContent && !isWide && (
        <ReplyDock
          currentUser={currentUser}
          value={replyContent}
          onChange={setReplyContent}
          onSubmit={handleMainReplySubmit}
          isPosting={isPostingComment}
          inputRef={composerRef}
          columnRef={columnRef}
          replyingTo={replyTarget?.username ?? null}
          onCancelReply={cancelReply}
        />
      )}
    </div>
  );
}
