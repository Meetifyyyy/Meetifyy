/*
 * CommentNode.jsx — the comment section of a post, Instagram-style.
 *
 * TWO LEVELS, WHATEVER THE DATA
 * The server keeps the real reply tree: a reply's `parentId` is the comment it
 * actually answers, which is also who gets the reply notification. The page
 * shows that tree two levels deep, the way Instagram does:
 *
 *   top-level comment
 *     reply                      ← answers the top-level comment
 *     @rohan reply               ← answers Rohan's reply; named, not indented
 *     reply
 *     View 4 more replies
 *
 * Every descendant of a top-level comment goes into ONE flat list under it, in
 * the order it was written. A reply that answers another reply (not the thread's
 * top comment) opens with "@that-person", derived from its real parent — so who
 * answers whom stays exact without a single extra indent, however long the
 * exchange runs. (Instagram's own API files a reply-to-a-reply under the top
 * comment and identifies the target by @mention; ours keeps the true parent and
 * derives the same thing.)
 *
 * Replies start folded behind "View N replies" and open a page at a time.
 * Replying to anything in a thread, or arriving at a #comment-<id> link inside
 * it, opens the whole thread so the reply is in view.
 */

import { useState, useCallback, useEffect, useMemo, useRef, useContext, createContext, useSyncExternalStore, memo } from 'react';
import { useNavigate } from 'react-router-dom';

import { CollegeRepresentativeBadge } from '@shared/components/badges/CollegeRepresentativeBadge';
import { getCollegeName } from '@shared/utils/user';
import Avatar, { getProcessedAvatarUrl } from '@shared/components/avatar/Avatar';
import ReportModal from '@shared/components/modals/ReportModal/LazyReportModal';
import RichText from '@shared/components/mentions/RichText';
import { normalizeBodyText, truncateBodyText, clipMentions, COMMENT_LIMITS } from '@shared/utils/bodyText';
import { timeAgo } from '@shared/utils/time';
import styles from './CommentNode.module.css';
import { useAuth } from '@shared/context/AuthContext';
import { useCommunities } from '@shared/hooks/useCommunities';
import { useDeleteComment } from '../../hooks/useDeleteComment';
import { useLikeComment } from '../../hooks/useLikeComment';
import { toggleRegistry } from '@shared/utils/mutationRegistry';
import ConfirmModal from '@shared/components/modals/ConfirmModal';
import Menu, { MenuItem } from '@shared/components/ui/Menu';
import { MoreHorizontal, Trash2, Flag, Loader2 } from '@shared/components/icons';

/** Replies revealed per "View more replies" tap. */
const REPLIES_PAGE = 5;

// ─── Shared tree context ─────────────────────────────────────────────────────
//
// Split in two, deliberately.
//
// One context carrying every piece of selection state re-rendered the whole
// section whenever any of it moved — opening one ⋯ menu re-rendered all 61
// comment bodies of a 60-comment post (measured, 44ms).
//
// `TreeActionsContext` holds callbacks that are stable for the life of the
// tree, so reading it is free. The per-comment flags live in a small external
// store each comment subscribes to for its own id only, so moving the reply
// target from A to B re-renders A and B and nothing else.
const TreeActionsContext = createContext({
  expand: () => {},
  collapse: () => {},
  setActiveMenuId: () => {},
  requestReply: () => {},
});

const TreeSelectionContext = createContext(null);

/**
 * Per-comment UI selection for one comment section.
 *
 * Deliberately not React state: a comment must be able to ask "am I the one
 * being replied to?" without every other comment being told the answer changed.
 *
 * `isExpanded` means "this thread is open in full". Threads start folded; a
 * thread opened a page at a time keeps that count in its own state, and this
 * flag forces it fully open (a reply was written into it, or a link pointed in).
 */
function createSelectionStore() {
  let expandedMap = {};
  let activeReplyId = null;
  let activeMenuId = null;
  const listeners = new Map(); // commentId -> Set<fn>
  // Snapshots must be referentially stable between notifications or
  // useSyncExternalStore loops. One cached object per comment id, replaced only
  // when that comment's own flags actually change.
  const snapshots = new Map();

  const computeSnapshot = (id) => ({
    isExpanded: expandedMap[id] === true,
    isReplying: activeReplyId === id,
    isMenuOpen: activeMenuId === id,
  });

  const notify = (ids) => {
    for (const id of ids) {
      const subs = listeners.get(id);
      if (!subs || subs.size === 0) { snapshots.delete(id); continue; }
      const next = computeSnapshot(id);
      const prev = snapshots.get(id);
      if (prev
        && prev.isExpanded === next.isExpanded
        && prev.isReplying === next.isReplying
        && prev.isMenuOpen === next.isMenuOpen) continue;
      snapshots.set(id, next);
      for (const fn of subs) fn();
    }
  };

  const setExpanded = (id, value) => {
    if ((expandedMap[id] === true) === value) return;
    expandedMap = { ...expandedMap, [id]: value };
    notify([id]);
  };

  return {
    subscribe(id, fn) {
      let subs = listeners.get(id);
      if (!subs) { subs = new Set(); listeners.set(id, subs); }
      subs.add(fn);
      return () => {
        subs.delete(fn);
        if (subs.size === 0) { listeners.delete(id); snapshots.delete(id); }
      };
    },
    getSnapshot(id) {
      let snap = snapshots.get(id);
      if (!snap) { snap = computeSnapshot(id); snapshots.set(id, snap); }
      return snap;
    },
    expand(id) { setExpanded(id, true); },
    collapse(id) { setExpanded(id, false); },
    setActiveReplyId(id) {
      if (activeReplyId === id) return;
      const touched = [activeReplyId, id].filter(Boolean);
      activeReplyId = id;
      notify(touched);
    },
    setActiveMenuId(id) {
      if (activeMenuId === id) return;
      const touched = [activeMenuId, id].filter(Boolean);
      activeMenuId = id;
      notify(touched);
    },
  };
}

/** Subscribe to one comment's own selection flags, and nothing else. */
function useNodeSelection(commentId) {
  const store = useContext(TreeSelectionContext);
  const subscribe = useCallback((fn) => store.subscribe(commentId, fn), [store, commentId]);
  const getSnapshot = useCallback(() => store.getSnapshot(commentId), [store, commentId]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** The top-level comment whose thread contains `targetId`, or null. */
function findThreadOf(roots, targetId) {
  const contains = (node) => node.id === targetId || (node.replies || []).some(contains);
  return roots.find(contains)?.id ?? null;
}

const createdAtMs = (c) => {
  const t = Date.parse(c.createdAt);
  // An optimistic reply may not carry a server timestamp yet: it is the newest.
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
};

/**
 * Every descendant of a top-level comment as one list, oldest first, each with
 * the username it answers when that is not the thread's top comment.
 *
 * Tree order breaks timestamp ties, so a reply never lands above the comment it
 * answers even when both carry the same second.
 */
function flattenThread(root) {
  const rows = [];
  const walk = (node) => {
    for (const child of node.replies || []) {
      rows.push({
        comment: child,
        replyTo: node.id === root.id ? null : (node.author?.username ?? null),
        order: rows.length,
      });
      walk(child);
    }
  };
  walk(root);
  rows.sort((a, b) => (createdAtMs(a.comment) - createdAtMs(b.comment)) || (a.order - b.order));
  return rows;
}

// ─── Section root ─────────────────────────────────────────────────────────────
export function CommentTreeRoot({ postId, comments, onReplyRequest, replyTargetId = null }) {
  // One store per mounted section. Its contents are UI selection, not data, so
  // it is deliberately not part of the render cycle — see createSelectionStore.
  const storeRef = useRef(null);
  if (storeRef.current === null) storeRef.current = createSelectionStore();
  const store = storeRef.current;

  // A #comment-<id> link: open the thread holding it, then bring it into view.
  useEffect(() => {
    if (!window.location.hash.startsWith('#comment-')) return undefined;
    const targetId = window.location.hash.replace('#comment-', '');
    const threadId = findThreadOf(comments, targetId);
    if (threadId && threadId !== targetId) store.expand(threadId);
    const t = setTimeout(() => {
      document.getElementById(`comment-${targetId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 120);
    return () => clearTimeout(t);
  }, [comments, store]);

  // Replies are written in the page's own composer (PostView). The section only
  // says which comment was picked, and marks the one currently being answered.
  const onReplyRequestRef = useRef(onReplyRequest);
  onReplyRequestRef.current = onReplyRequest;
  const requestReply = useCallback((target) => onReplyRequestRef.current?.(target), []);

  useEffect(() => {
    store.setActiveReplyId(replyTargetId);
  }, [store, replyTargetId]);

  const treeActions = useMemo(
    () => ({
      expand: store.expand,
      collapse: store.collapse,
      requestReply,
      setActiveMenuId: store.setActiveMenuId,
    }),
    [store, requestReply],
  );

  return (
    <TreeSelectionContext.Provider value={store}>
      <TreeActionsContext.Provider value={treeActions}>
        <div className={styles.treeRoot}>
          {comments.map((comment) => (
            <CommentNode key={comment.id} postId={postId} comment={comment} />
          ))}
        </div>
      </TreeActionsContext.Provider>
    </TreeSelectionContext.Provider>
  );
}

// ─── Thread: a top-level comment and its replies ─────────────────────────────
function CommentThreadImpl({ postId, comment }) {
  const { collapse } = useContext(TreeActionsContext);
  const { isExpanded } = useNodeSelection(comment.id);
  // Replies revealed by "View more replies", a page at a time.
  const [shown, setShown] = useState(0);

  const replies = useMemo(() => flattenThread(comment), [comment]);
  const total = replies.length;
  const visible = isExpanded ? total : Math.min(shown, total);
  const hidden = total - visible;

  const showMore = () => setShown(visible + REPLIES_PAGE);
  const hideAll = () => { setShown(0); collapse(comment.id); };

  return (
    <div className={styles.thread}>
      <CommentItem postId={postId} comment={comment} threadId={comment.id} isReply={false} />

      {total > 0 && (
        <div className={styles.replies}>
          {replies.slice(0, visible).map(({ comment: reply, replyTo }) => (
            <CommentItem
              key={reply.id}
              postId={postId}
              comment={reply}
              threadId={comment.id}
              replyTo={replyTo}
              isReply
            />
          ))}

          {/* One control, as on Instagram: more to show → "View N more";
              everything showing → "Hide replies". */}
          <button
            type="button"
            className={styles.replyToggle}
            aria-expanded={hidden === 0}
            onClick={hidden > 0 ? showMore : hideAll}
          >
            {hidden === 0
              ? 'Hide replies'
              : visible === 0
                ? `View ${total} ${total === 1 ? 'reply' : 'replies'}`
                : `View ${hidden} more ${hidden === 1 ? 'reply' : 'replies'}`}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * A thread re-renders when anything inside it changes — its `comment` object is
 * rebuilt whenever a descendant is (see buildCommentTree in PostView). The rows
 * inside it are memoised on their own comment, so a like on one reply still
 * re-renders that one row only.
 */
const CommentNode = memo(CommentThreadImpl);
CommentNode.displayName = 'CommentThread';

// ─── One comment row: a top-level comment or a reply ─────────────────────────
function CommentItemImpl({ postId, comment, threadId, replyTo = null, isReply }) {
  const menuTriggerRef = useRef(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [hasReported, setHasReported] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [isTextExpanded, setIsTextExpanded] = useState(false);
  // Bumped on every tap so the icon's pop restarts (it is the svg's key); zero
  // means "never tapped here", so liked comments do not all pop on load.
  const [likeTap, setLikeTap] = useState(0);

  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { communitiesById } = useCommunities();
  const { mutate: deleteCommentMutate } = useDeleteComment();
  const { mutate: toggleLike } = useLikeComment();
  const { expand, requestReply, setActiveMenuId } = useContext(TreeActionsContext);
  // This comment's own flags, and only this comment's.
  const { isReplying, isMenuOpen: showMenu } = useNodeSelection(comment.id);

  const setShowMenu = useCallback(
    (next) => setActiveMenuId(next ? comment.id : null),
    [setActiveMenuId, comment.id],
  );

  // Same rule as posts, from the authorizer the DELETE endpoint enforces with.
  // Falls back to authorship on an older payload, which under-offers rather
  // than showing a refused control.
  const canDeleteComment =
    comment?.canDelete ?? Boolean(currentUser && comment.authorId === currentUser.id);
  // Removing someone else's comment is moderation: the confirm says so.
  const isModeratingOthersComment =
    canDeleteComment && !(currentUser && comment.authorId === currentUser.id);

  const normalizedText = normalizeBodyText(comment.text);
  const textClip = truncateBodyText(normalizedText, COMMENT_LIMITS);
  const isTextClipped = textClip.needsTruncation && !isTextExpanded;
  const displayedText = isTextClipped ? textClip.text : normalizedText;
  const displayedMentions = isTextClipped
    ? clipMentions(comment.mentions, displayedText)
    : comment.mentions;

  // Who this answers, unless the writer already opened with that mention.
  const showReplyTo = !!replyTo
    && !normalizedText.trimStart().toLowerCase().startsWith(`@${replyTo.toLowerCase()}`);

  const author = comment.author || { displayName: 'Unknown', username: 'unknown', avatar: '?' };
  const authorCollege = (author.collegeId && communitiesById) ? communitiesById[author.collegeId] : null;
  const authorCollegeName = getCollegeName(author, '') || authorCollege?.name || '';
  const initialLiked = comment.hasLiked !== undefined ? comment.hasLiked : (comment.likedBy ? comment.likedBy.includes(currentUser?.id) : false);
  const initialLikes = comment.likeCount !== undefined ? comment.likeCount : (comment.likes || 0);
  const localLiked = toggleRegistry.getLatestIntent(`likeComment:${comment.id}`, initialLiked);
  const localLikesCount = initialLikes + (localLiked !== initialLiked ? (localLiked ? 1 : -1) : 0);

  const handleProfileClick = () => navigate(`/profile/${author.username}`, { state: { from: window.location.pathname } });

  // The reply is written in the page's composer and filed under THIS comment
  // (so its author is the one notified). The thread opens in full so the reply
  // appears where it was written.
  const handleReplyClick = () => {
    expand(threadId);
    requestReply({ id: comment.id, username: author.username });
  };

  const runDelete = () => {
    if (isDeleting) return;
    // Released by the mutation's own callbacks: a try/finally around a
    // fire-and-forget mutate cleared the guard in the same tick it was set.
    setIsDeleting(true);
    deleteCommentMutate(
      { postId, commentId: comment.id },
      { onSettled: () => setIsDeleting(false) },
    );
  };

  const handleDelete = (e) => {
    e.stopPropagation();
    setShowMenu(false);
    if (isDeleting) return;
    // Every delete confirms first: it cannot be undone.
    setConfirmRemove(true);
  };

  const handleLike = () => {
    setLikeTap((n) => n + 1);
    toggleLike({ commentId: comment.id, isLiked: !localLiked, postId });
  };

  const rowClass = `${styles.comment} ${isReply ? styles.reply : styles.topLevel}`;

  // ─── Deleted: a placeholder, kept so the replies around it still make sense.
  if (comment.isDeleted) {
    return (
      <div id={`comment-${comment.id}`} className={`${rowClass} ${styles.commentDeleted}`} data-comment-card>
        <div className={`${styles.avatar} ${styles.avatarDeleted}`} aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
          </svg>
        </div>
        <div className={styles.body}>
          <div className={styles.deletedLabel}>This comment has been deleted.</div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        id={`comment-${comment.id}`}
        className={`${rowClass} ${isReplying ? styles.commentActive : ''}`}
        data-comment-card
      >
        <div className={styles.avatar}>
          <Avatar
            src={author.avatar}
            name={author.displayName}
            size="100%"
            onClick={handleProfileClick}
          />
        </div>

        <div className={styles.body}>
          <div className={styles.header}>
            <div className={styles.identity}>
              <button type="button" onClick={handleProfileClick} className={`hover-underline ${styles.nameButton}`}>
                <span className={styles.username}>{author.username}</span>
                <CollegeRepresentativeBadge isCampusRep={author.isCampusRep} collegeName={authorCollegeName} user={author} size="sm" />
                {authorCollege && (
                  <img
                    src={getProcessedAvatarUrl(authorCollege.avatar)}
                    alt={authorCollege.name}
                    className={styles.collegeIcon}
                    title={authorCollege.name}
                    onError={(e) => { e.target.onerror = null; e.target.src = '/default_avatar.svg'; }}
                  />
                )}
              </button>
              <span className={styles.time}>{comment.createdAt ? timeAgo(comment.createdAt) : comment.time}</span>
            </div>

            <div className={styles.menuWrapper}>
              <button
                ref={menuTriggerRef}
                type="button"
                onClick={() => setShowMenu(!showMenu)}
                className={styles.menuBtn}
                aria-haspopup="menu"
                aria-expanded={showMenu}
                aria-label="More options"
              >
                <MoreHorizontal size={16} />
              </button>

              <Menu
                open={showMenu}
                onClose={() => setShowMenu(false)}
                anchorRef={menuTriggerRef}
                size="sm"
                ariaLabel="Comment options"
              >
                {canDeleteComment && (
                  <MenuItem
                    icon={isDeleting ? Loader2 : Trash2}
                    tone="danger"
                    disabled={isDeleting}
                    onSelect={handleDelete}
                  >
                    {isDeleting ? 'Deleting…' : 'Delete'}
                  </MenuItem>
                )}
                {(!currentUser || comment.authorId !== currentUser.id) && (
                  <MenuItem
                    icon={Flag}
                    disabled={hasReported}
                    onSelect={() => setShowReportModal(true)}
                    onClose={() => setShowMenu(false)}
                  >
                    {hasReported ? 'Already reported' : 'Report'}
                  </MenuItem>
                )}
              </Menu>
            </div>
          </div>

          <div className={styles.text}>
            {showReplyTo && <span className={styles.replyTo}>@{replyTo} </span>}
            <RichText content={displayedText} mentions={displayedMentions} urlLimit={30} />
            {/* See the note in Post.jsx: the space lets this read as part of
                the sentence and lets the line wrap here. */}
            {textClip.needsTruncation && ' '}
            {textClip.needsTruncation && (
              <button
                type="button"
                className={styles.seeMoreBtn}
                aria-expanded={isTextExpanded}
                onClick={() => setIsTextExpanded((v) => !v)}
              >
                {isTextExpanded ? 'See less' : 'See more'}
              </button>
            )}
          </div>

          <div className={styles.actions}>
            <button
              type="button"
              onClick={handleLike}
              className={`${styles.actionBtn} ${styles.likeBtn} ${localLiked ? styles.actionBtnLiked : ''}`}
              aria-pressed={localLiked}
              aria-label={`${localLiked ? 'Unlike' : 'Like'} comment, ${localLikesCount} ${localLikesCount === 1 ? 'like' : 'likes'}`}
            >
              <svg
                key={likeTap}
                className={likeTap > 0 && localLiked ? styles.likePop : undefined}
                width="14" height="14" viewBox="0 0 24 24" fill={localLiked ? 'var(--color-primary)' : 'none'} stroke={localLiked ? 'var(--color-primary)' : 'currentColor'} strokeWidth="2.5" aria-hidden="true">
                <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
              </svg>
              {localLikesCount > 0 && <span>{localLikesCount}</span>}
            </button>
            <button
              type="button"
              onClick={handleReplyClick}
              className={`${styles.actionBtn} ${isReplying ? styles.actionBtnActive : ''}`}
              aria-pressed={isReplying}
            >
              Reply
            </button>
          </div>
        </div>
      </div>

      {/*
        * Both dialogs are mounted only while open: ReportModal builds a form
        * instance before its own `if (!isOpen) return null`, so rendering it
        * per comment carried one live form per comment (measured).
        */}
      {confirmRemove && (
        <ConfirmModal
          visible={confirmRemove}
          title="Delete comment?"
          desc={isModeratingOthersComment
            ? `This comment by @${author.username} will be permanently removed, and they will be notified.`
            : 'This comment will be permanently removed. This action cannot be undone.'}
          confirmText="Delete"
          cancelText="Cancel"
          isDestructive
          onCancel={() => setConfirmRemove(false)}
          onConfirm={() => { setConfirmRemove(false); runDelete(); }}
        />
      )}

      {showReportModal && (
        <ReportModal
          isOpen={showReportModal}
          onClose={() => setShowReportModal(false)}
          targetType="COMMENT"
          targetId={comment.id}
          targetPreview={comment.text?.slice(0, 80)}
          targetName={author?.displayName || author?.username}
          targetAvatar={author?.avatar}
          reportedFrom="comment"
          onSubmitted={() => setHasReported(true)}
        />
      )}
    </>
  );
}

/**
 * Memoised on its own props: `comment` keeps its identity across cache updates
 * unless that comment (or something under it) changed, and the rest are
 * primitives. Liking one comment re-renders one row.
 */
const CommentItem = memo(CommentItemImpl);
CommentItem.displayName = 'CommentItem';

export default CommentNode;
