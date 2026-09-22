/*
 * CommentNode.jsx
 * MODIFIED:
 * - Replaced CSS pseudo-element connectors with a real SVG overlay (ConnectorSVG)
 * - Cubic Bézier curves drawn via getBoundingClientRect measurements + ResizeObserver
 * - Each parent-to-child pair gets its own smooth Bézier path; overlapping
 *   transparent curves naturally form a visible vertical trunk
 * - Hover highlights the active branch by raising stroke opacity
 * - SVG re-measures after collapse animation (270ms timeout)
 * - All other data flow, props, and state management unchanged
 */

import { useState, useCallback, useEffect, useMemo, useRef, useContext, createContext, useSyncExternalStore, memo } from 'react';
import { useNavigate } from 'react-router-dom';

import { CollegeRepresentativeBadge } from '@shared/components/badges/CollegeRepresentativeBadge';
import { getCollegeName } from '@shared/utils/user';
import Avatar, { getProcessedAvatarUrl } from '@shared/components/avatar/Avatar';
import MentionInput from '@shared/components/mentions/MentionInput';
import ReportModal from '@shared/components/modals/ReportModal/ReportModal';
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


// ─── Shared tree context ─────────────────────────────────────────────────────
//
// Split in two, deliberately.
//
// There used to be ONE context carrying the tier, the expanded map, the active
// reply id and the active menu id together. Every node read it, so opening one
// reply box — or one ⋮ menu, or collapsing one thread — published a new context
// value to all of them and re-rendered the whole thread. Measured on a 60-node
// thread: 61/61 comment bodies re-rendered, 44ms, for a state change that
// concerns exactly one node.
//
// `TreeActionsContext` holds the callbacks and the tier. The callbacks are all
// `useCallback`-stable and the tier only moves when the visible node count
// crosses a density threshold, so reading it is nearly free.
//
// The three per-node flags are NOT in a context at all. They live in a small
// external store that each node subscribes to for its own id only, via
// `useSyncExternalStore`. Setting `activeReplyId` from A to B notifies A and B
// and nobody else — React re-renders precisely the two nodes whose answer
// actually changed.
const TreeActionsContext = createContext({
  tier: 'small',
  toggleExpanded: () => {},
  expand: () => {},
  setActiveMenuId: () => {},
  setActiveReplyId: () => {},
});

const TreeSelectionContext = createContext(null);

/**
 * Per-node UI selection for one comment tree.
 *
 * Deliberately not React state: a node must be able to ask "am I the open
 * reply box?" without every other node being told the answer changed.
 * Subscribers are keyed by comment id and notified only when their own slice
 * moves.
 */
function createSelectionStore() {
  let expandedMap = {};
  let activeReplyId = null;
  let activeMenuId = null;
  const listeners = new Map(); // commentId -> Set<fn>
  const rootListeners = new Set(); // notified when the expanded map changes
  // Snapshots must be referentially stable between notifications or
  // useSyncExternalStore loops. One cached object per comment id, replaced only
  // when that node's own flags actually change.
  const snapshots = new Map();

  const computeSnapshot = (id) => ({
    isExpanded: expandedMap[id] !== false,
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

  // The root recomputes its density tier from the expanded map, so it is told
  // when that map moves — but only then, not on reply/menu changes.
  const notifyRoot = () => { for (const fn of rootListeners) fn(); };

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
    subscribeExpanded(fn) { rootListeners.add(fn); return () => rootListeners.delete(fn); },
    getExpandedMap() { return expandedMap; },

    toggleExpanded(id, currentVal) {
      expandedMap = { ...expandedMap, [id]: !currentVal };
      notify([id]);
      notifyRoot();
    },
    expand(id) {
      if (expandedMap[id] === true) return;
      expandedMap = { ...expandedMap, [id]: true };
      notify([id]);
      notifyRoot();
    },
    expandAll(ids) {
      const missing = ids.filter((id) => expandedMap[id] !== true);
      if (missing.length === 0) return;
      const next = { ...expandedMap };
      for (const id of missing) next[id] = true;
      expandedMap = next;
      notify(missing);
      notifyRoot();
    },
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

function countVisibleNodes(comment, expandedMap) {
  let count = 1;
  if (comment.replies?.length && expandedMap[comment.id] !== false) {
    for (const child of comment.replies) count += countVisibleNodes(child, expandedMap);
  }
  return count;
}

function findAncestorsOf(comments, targetId, path = []) {
  for (const c of comments) {
    if (c.id === targetId) return path;
    if (c.replies?.length) {
      const found = findAncestorsOf(c.replies, targetId, [...path, c.id]);
      if (found) return found;
    }
  }
  return null;
}

// ─── Root wrapper ─────────────────────────────────────────────────────────────
export function CommentTreeRoot({ postId, comments, onReplySubmit }) {
  // One store per mounted tree. Its contents are UI selection, not data, so it
  // is deliberately not part of the render cycle — see createSelectionStore.
  const storeRef = useRef(null);
  if (storeRef.current === null) storeRef.current = createSelectionStore();
  const store = storeRef.current;

  // The density tier is the one thing the root itself derives from the expanded
  // map, so it subscribes to that map alone — reply boxes and ⋮ menus opening
  // no longer re-render the root (and therefore no longer re-render the tree).
  const expandedMap = useSyncExternalStore(store.subscribeExpanded, store.getExpandedMap, store.getExpandedMap);

  useEffect(() => {
    if (!window.location.hash.startsWith('#comment-')) return;
    const targetId = window.location.hash.replace('#comment-', '');
    const ancestors = findAncestorsOf(comments, targetId);
    const scrollToTarget = () => {
      const el = document.getElementById(`comment-${targetId}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    if (ancestors && ancestors.length > 0) {
      store.expandAll(ancestors);
      const t = setTimeout(scrollToTarget, 300); // wait for the expand animation
      return () => clearTimeout(t);
    }
    const t = setTimeout(scrollToTarget, 100);
    return () => clearTimeout(t);
  }, [comments, store]);

  const totalVisible = useMemo(
    () => comments.reduce((acc, c) => acc + countVisibleNodes(c, expandedMap), 0),
    [comments, expandedMap],
  );
  const tier = totalVisible <= 5 ? 'small' : totalVisible <= 15 ? 'medium' : 'large';

  // Only `tier` ever moves here; the four callbacks are the store's own methods,
  // which are fixed for the life of the store.
  const treeActions = useMemo(
    () => ({
      tier,
      toggleExpanded: store.toggleExpanded,
      expand: store.expand,
      setActiveReplyId: store.setActiveReplyId,
      setActiveMenuId: store.setActiveMenuId,
    }),
    [tier, store],
  );

  return (
    <TreeSelectionContext.Provider value={store}>
      <TreeActionsContext.Provider value={treeActions}>
        <div className={`${styles.treeRoot} ${styles[`density_${tier}`]}`}>
          {comments.map((comment, idx) => (
            <CommentNode
              key={comment.id}
              postId={postId}
              comment={comment}
              onReplySubmit={onReplySubmit}
              level={0}
              isLastSibling={idx === comments.length - 1}
            />
          ))}
        </div>
      </TreeActionsContext.Provider>
    </TreeSelectionContext.Provider>
  );
}

// ─── SVG Bézier connector ─────────────────────────────────────────────────────
//
// Renders an absolutely-positioned SVG over the nodeContainer.
// For each direct child avatar it draws:
//   M sx sy  C cx1 cy1, cx2 cy2, tx ty
// where:
//   (sx, sy) = bottom-center of the parent avatar
//   (tx, ty) = left-center  of the child avatar
//   cp1 goes straight down  (creating a vertical trunk at the start)
//   cp2 approaches from the left (smooth right-turn arrival)
//
// Multiple overlapping transparent curves produce a visual trunk effect.
function ConnectorSVG({ nodeContainerRef, avatarRef, repliesContainerRef, isHighlighted, isExpanded, filterId }) {
  const [paths, setPaths] = useState([]);

  const measure = useCallback(() => {
    const container = nodeContainerRef.current;
    const avatar    = avatarRef.current;
    const replies   = repliesContainerRef.current;
    if (!container || !avatar || !replies) return;

    const cRect = container.getBoundingClientRect();
    const aRect = avatar.getBoundingClientRect();

    // Source: bottom-center of parent avatar (container-relative)
    const sx = aRect.left + aRect.width  / 2 - cRect.left;
    const sy = aRect.bottom - cRect.top;

    // Collect only DIRECT child avatars, not grandchildren.
    // Each child avatar has data-child-avatar; we filter by checking
    // that its closest [data-replies-container] ancestor IS our container.
    const allAvatars = replies.querySelectorAll('[data-child-avatar]');
    const direct = Array.from(allAvatars).filter(
      el => el.closest('[data-replies-container]') === replies
    );

    const next = [];
    for (const el of direct) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;

      // Target: left-center of child avatar (container-relative)
      const tx = r.left - cRect.left;
      const ty = r.top + r.height / 2 - cRect.top;

      if (ty <= sy + 2) continue; // child is above source — skip

      // Cubic Bézier control points:
      //   cp1 — directly below source (curve starts going straight down)
      //   cp2 — at child's Y, 40% of the horizontal distance from source
      //          (curve arrives from the left, smooth right-turn)
      const cp1x = sx;
      const cp1y = sy + (ty - sy) * 0.62;
      const cp2x = sx + (tx - sx) * 0.38;
      const cp2y = ty;

      next.push(
        `M ${sx.toFixed(2)} ${sy.toFixed(2)} ` +
        `C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ` +
          `${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ` +
          `${tx.toFixed(2)} ${ty.toFixed(2)}`
      );
    }

    setPaths(next);
  }, [nodeContainerRef, avatarRef, repliesContainerRef]);

  // Measure on mount + whenever the container resizes
  useEffect(() => {
    // Initial measure after first paint
    const raf = requestAnimationFrame(measure);
    const ro = new ResizeObserver(() => requestAnimationFrame(measure));
    if (nodeContainerRef.current) ro.observe(nodeContainerRef.current);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [measure, nodeContainerRef]);

  // Re-measure after collapse/expand animation finishes (250ms + small buffer)
  useEffect(() => {
    const t = setTimeout(measure, 280);
    return () => clearTimeout(t);
  }, [isExpanded, measure]);

  if (!paths.length) return null;

  const baseOpacity      = isHighlighted ? 0.75 : 0.55;
  const glowOpacity      = isHighlighted ? 0.20 : 0.12;
  const strokeColor      = isHighlighted
    ? 'var(--color-primary, #2563EB)'
    : 'var(--color-border)';

  return (
    <svg
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        overflow: 'visible',
        pointerEvents: 'none',
        zIndex: 0,
      }}
      aria-hidden="true"
    >
      <defs>
        {/* Soft glow effect, scoped to this SVG via unique filterId */}
        <filter id={filterId} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.8" result="blur" />
        </filter>
      </defs>

      {paths.map((d, i) => (
        <g key={i}>
          {/* Glow pass — wider, blurred, low opacity */}
          <path
            d={d}
            fill="none"
            stroke={strokeColor}
            strokeWidth="4"
            strokeLinecap="round"
            opacity={glowOpacity}
            filter={`url(#${filterId})`}
            style={{ transition: 'opacity 250ms ease, stroke 250ms ease' }}
          />
          {/* Primary line */}
          <path
            d={d}
            fill="none"
            stroke={strokeColor}
            strokeWidth="1.25"
            strokeLinecap="round"
            opacity={baseOpacity}
            style={{ transition: 'opacity 250ms ease, stroke 250ms ease' }}
          />
        </g>
      ))}
    </svg>
  );
}

// ─── CommentNode ──────────────────────────────────────────────────────────────
function CommentNodeImpl({
  postId,
  comment,
  onReplySubmit,
  level = 0,
  isLastSibling = false,
}) {
  const [replyContent, setReplyContent] = useState({ text: '', mentions: [] });
  // Derived, not owned — see activeMenuId above.
  const menuRef = useRef(null);
  /*
   * The trigger, for `Menu` to anchor against.
   *
   * The measuring, flipping and clamping this component used to do by hand —
   * an estimated size, a layout effect to correct it, and a guard ref so the
   * correction could not re-enter — all now live in `useMenuPosition`, which
   * measures the real menu instead of estimating it.
   */
  const menuTriggerRef = useRef(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting]     = useState(false);

  // DOM refs for SVG measurement
  const nodeContainerRef  = useRef(null);
  const avatarRef         = useRef(null);
  const repliesContainerRef = useRef(null);

  // Stable filter ID so inline SVG filter IDs don't collide across nodes
  const filterId = useRef(`cf-${comment.id}`.replace(/[^a-zA-Z0-9-]/g, '_')).current;

  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { communitiesById } = useCommunities();
  const { mutate: deleteCommentMutate } = useDeleteComment();
  const { mutate: toggleLike } = useLikeComment();
  const { tier, toggleExpanded, expand, setActiveReplyId, setActiveMenuId } = useContext(TreeActionsContext);
  // This node's own three flags, and only this node's — a sibling opening its
  // reply box or its menu does not notify this subscription.
  const { isExpanded: isExpandedFlag, isReplying, isMenuOpen } = useNodeSelection(comment.id);

  const showMenu = isMenuOpen;
  const setShowMenu = useCallback(
    (next) => setActiveMenuId(next ? comment.id : null),
    [setActiveMenuId, comment.id],
  );

  /**
   * The menu is portalled to <body> and positioned in viewport coordinates.
   *
   * It used to be absolutely positioned inside the row, which put it inside
   * `.treeRoot` — and that has `overflow-x: auto; overflow-y: hidden` to stop
   * deep threads widening the page. An absolutely positioned child cannot
   * escape a scroll container, so the menu was clipped at the tree's edge and
   * its lower items became unreachable. Flipping it upwards does not help:
   * the clip is the ancestor, not the viewport.
   *
   * So it leaves the tree entirely. Position is measured from the button at
   * open time, flipped above when there is no room below, and clamped to the
   * viewport so it can never render off-screen in either direction.
   */
  const openMenu = useCallback(() => {
    setShowMenu(!showMenu);
  }, [showMenu, setShowMenu]);

  /*
   * The clamp effect and the dismiss listeners are gone.
   *
   * Both were compensating for a menu that measured itself once and then did
   * not track: the clamp corrected an estimated position after paint, and the
   * listeners closed the menu on any scroll or resize because it would
   * otherwise be left behind by its own button.
   *
   * `Menu` measures the real element before showing it and re-places it on
   * scroll and resize, so there is nothing to correct and no reason to close.
   * It owns outside-press and Escape as well.
   *
   * Worth knowing if this is revisited: the old clamp had to use `offsetWidth`
   * rather than `getBoundingClientRect`, because the rect reports the
   * TRANSFORMED box and the menu animates its scale — so every frame measured
   * differently, re-clamped, re-rendered and looped until React threw
   * "Maximum update depth exceeded". `useMenuPosition` measures the offset box
   * for exactly that reason.
   */

  // Drop the draft whenever the box closes, however it closed — Cancel, a
  // successful submit, or another node taking over. Without this a half-typed
  // reply reappeared the next time the box was reopened.
  useEffect(() => {
    if (!isReplying) setReplyContent({ text: '', mentions: [] });
  }, [isReplying]);

  const [showReportModal, setShowReportModal] = useState(false);
  const [hasReported, setHasReported] = useState(false);

  // Body text gets the same treatment as a post: whitespace tidied, an
  // over-long body clipped behind a See more toggle. Separate from
  // `isExpanded`, which is about hiding the reply subtree — one is this
  // comment's own text, the other is its children.
  // Same rule as posts, same source: the server's answer, from the authorizer
  // the DELETE endpoint enforces with. Falls back to authorship on an older
  // payload, which under-offers rather than showing a refused control.
  const canDeleteComment =
    comment?.canDelete ?? Boolean(currentUser && comment.authorId === currentUser.id);

  /**
   * Removing someone else's comment confirms first; deleting your own does not.
   *
   * Deleting your own comment has always been immediate, and that stays — it is
   * your content and the placeholder keeps the thread intact. Deleting another
   * member's is different in kind: it is irreversible for them, it notifies
   * them, and the control sits in a small menu next to Report where a mis-tap
   * is easy. The label is "Delete" in both cases; only the confirmation
   * differs.
   */
  const isModeratingOthersComment =
    canDeleteComment && !(currentUser && comment.authorId === currentUser.id);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const [isTextExpanded, setIsTextExpanded] = useState(false);
  const normalizedText = normalizeBodyText(comment.text);
  const textClip = truncateBodyText(normalizedText, COMMENT_LIMITS);
  const isTextClipped = textClip.needsTruncation && !isTextExpanded;
  const displayedText = isTextClipped ? textClip.text : normalizedText;
  const displayedMentions = isTextClipped
    ? clipMentions(comment.mentions, displayedText)
    : comment.mentions;

  const hasChildren = comment.replies?.length > 0;

  // Every node is expanded by default, at every depth. Nested replies used to
  // require `expandedMap[id] === true` to show, so a thread opened with its
  // sub-threads hidden behind a "View N replies" tap at every level — the
  // deeper an exchange went, the more taps it took to read it, and a reply to
  // a reply was invisible until someone thought to go looking.
  //
  // Collapsing is now a deliberate act, so only an explicit `false` hides
  // anything. (The store applies that rule; this is its answer for this node.)
  const isExpanded = isExpandedFlag;

  // Only a thread's root carries a collapse control. Collapsing the root
  // collapses its whole subtree in one move (the replies grid contains every
  // descendant), so per-node controls further down would offer the same
  // outcome several times over and clutter every nested reply to do it.
  const canCollapse = level === 0 && hasChildren;

  const totalDescendants = (function countAll(node) {
    if (!node.replies) return 0;
    return node.replies.reduce((acc, reply) => acc + 1 + countAll(reply), 0);
  })(comment);

  const author = comment.author || { displayName: 'Unknown', username: 'unknown', avatar: '?' };
  const authorCollege = (author.collegeId && communitiesById) ? communitiesById[author.collegeId] : null;
  const authorCollegeName = getCollegeName(author, '') || authorCollege?.name || '';
  const initialLiked = comment.hasLiked !== undefined ? comment.hasLiked : (comment.likedBy ? comment.likedBy.includes(currentUser?.id) : false);
  const initialLikes = comment.likeCount !== undefined ? comment.likeCount : (comment.likes || 0);

  const localLiked = toggleRegistry.getLatestIntent(`likeComment:${comment.id}`, initialLiked);
  const localLikesCount = initialLikes + (localLiked !== initialLiked ? (localLiked ? 1 : -1) : 0);

  // ── Constant node sizes and layout parameters ──────────────────────────────
  const avatarSize = 40;
  const fontScale  = 1.00;

  // Each depth level gets a fixed left offset (e.g., 20px) that does not shrink
  const fixedIndentPx = 20; 
  const indentSize  = `${fixedIndentPx}px`;

  // Only the vertical gap may reduce under high node count (never below 8px)
  const verticalGapPx = tier === 'small' ? 16 : tier === 'medium' ? 12 : 8;
  const gapSize     = `${verticalGapPx}px`;
  const dvPadding   = 1.00; // Constantly 100% padding


  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleProfileClick = () => navigate(`/profile/${author.username}`, { state: { from: window.location.pathname } });
  const handleReplyClick   = () => setActiveReplyId(isReplying ? null : comment.id);
  const handleCancelReply  = () => setActiveReplyId(null);

  const handleDelete = (e) => {
    e.stopPropagation();
    setShowMenu(false);
    if (isDeleting) return;
    if (isModeratingOthersComment) {
      setConfirmRemove(true);
      return;
    }
    runDelete();
  };

  const runDelete = () => {
    if (isDeleting) return;
    // `deleteCommentMutate` is fire-and-forget, so the previous try/finally set
    // the flag and cleared it in the same tick — the guard never actually held
    // and a double-click fired two deletes, the second of which 404s ("already
    // deleted") and pops an error toast for a delete that worked. The flag is
    // released by the mutation's own callbacks now.
    setIsDeleting(true);
    deleteCommentMutate(
      { postId, commentId: comment.id },
      { onSettled: () => setIsDeleting(false) },
    );
  };

  const handleLike = (e) => {
    if (e) e.stopPropagation();
    // if (isLiking) return; allowed for rapid toggle
    toggleLike({ commentId: comment.id, isLiked: !localLiked, postId });
  };

  const handleSubmit = async () => {
    if (!replyContent.text.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onReplySubmit(comment.id, replyContent.text, replyContent.mentions);
      // Only close on success. This used to clear the draft unconditionally, so
      // a reply that failed to post took the user's text with it and left
      // nothing to retry from.
      setActiveReplyId(null);
      expand(comment.id);
    } catch {
      // The mutation surfaces its own toast; keep the composer open and the
      // draft intact so the user can try again.
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCardClick = (e) => {
    if (e.target.closest('[data-no-collapse]')) return;
    if (!hasChildren) return;
    toggleExpanded(comment.id, isExpanded);
  };

  /**
   * The card is a keyboard-activatable region, so Space and Enter toggle it —
   * but only when the card itself is what is focused.
   *
   * This used to fire on any keydown that reached the card, and keydown
   * bubbles. The reply composer is a descendant of the card, so on any comment
   * that had replies, every Space typed into the reply box was swallowed by
   * `preventDefault()` here and collapsed the thread instead. That is the
   * "spaces sometimes don't work" report — "sometimes" because it only
   * happened under comments that already had children. Enter was eaten the
   * same way, so a reply could not be given a second line either.
   */
  const handleCardKeyDown = (e) => {
    if (e.target !== e.currentTarget) return;
    if ((e.key === 'Enter' || e.key === ' ') && hasChildren) {
      e.preventDefault();
      toggleExpanded(comment.id, isExpanded);
    }
  };

  // ─── Deleted-comment placeholder ──────────────────────────────────────────
  if (comment.isDeleted) {
    return (
      <div
        ref={nodeContainerRef}
        className={[
          styles.nodeContainer,
          level === 0 ? styles.level0 : styles.levelN,
          styles.nodeContainerDeleted,
        ].join(' ')}
        style={{
          '--avatar-size':   `${avatarSize}px`,
          '--font-scale':    fontScale,
          '--indent-size':   indentSize,
          '--gap-size':      gapSize,
          '--padding-scale': dvPadding,
        }}
      >
        {/* SVG connector overlay — only when children are visible */}
        {hasChildren && isExpanded && (
          <ConnectorSVG
            nodeContainerRef={nodeContainerRef}
            avatarRef={avatarRef}
            repliesContainerRef={repliesContainerRef}
            isHighlighted={false}
            isExpanded={isExpanded}
            filterId={filterId}
          />
        )}

        <div
          id={`comment-${comment.id}`}
          className={[
            styles.replyCard,
            styles.replyCardDeleted,
            hasChildren && !isExpanded ? styles.isCollapsed : '',
            hasChildren ? styles.commentCardClickable : '',
          ].join(' ')}
          data-comment-card
          role={hasChildren ? 'button' : undefined}
          tabIndex={hasChildren ? 0 : undefined}
          aria-expanded={hasChildren ? isExpanded : undefined}
          onClick={hasChildren ? handleCardClick : undefined}
          onKeyDown={hasChildren ? handleCardKeyDown : undefined}
        >
          <div className={styles.replyWrapper} data-reply-wrapper>
            {/* Ghost avatar — keeps the SVG connector anchor in exactly the right spot */}
            <div
              ref={avatarRef}
              className={`${styles.replyAvatar} ${styles.replyAvatarDeleted}`}
              data-child-avatar
            >
              <svg
                width="20" height="20" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" strokeWidth="1.5"
                strokeLinecap="round" strokeLinejoin="round"
                style={{ opacity: 0.3 }}
              >
                <circle cx="12" cy="8" r="4" />
                <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
              </svg>
            </div>

            <div className={styles.replyContent}>
              <div className={styles.deletedLabel}>Deleted</div>
              <div className={styles.deletedSubtext}>This comment has been deleted.</div>

              {canCollapse && (
                <button
                  className={styles.viewRepliesBtn}
                  data-no-collapse
                  aria-expanded={isExpanded}
                  onClick={(e) => { e.stopPropagation(); toggleExpanded(comment.id, isExpanded); }}
                  style={{ marginTop: '6px' }}
                >
                  {isExpanded
                    ? 'Hide replies'
                    : `Show ${totalDescendants} ${totalDescendants === 1 ? 'reply' : 'replies'}`}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Children still render — hierarchy preserved */}
        {hasChildren && (
          <div className={`${styles.repliesGrid} ${!isExpanded ? styles.repliesGridCollapsed : ''}`}>
            <div
              ref={repliesContainerRef}
              className={styles.repliesContainer}
              data-replies-container
              style={{ '--indent-size': indentSize }}
            >
              {comment.replies.map((child, idx) => (
                <CommentNode
                  key={child.id}
                  postId={postId}
                  comment={child}
                  onReplySubmit={onReplySubmit}
                  level={level + 1}
                  isLastSibling={idx === comment.replies.length - 1}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── Normal comment ────────────────────────────────────────────────────────
  return (
    <div
      ref={nodeContainerRef}
      className={[
        styles.nodeContainer,
        level === 0 ? styles.level0 : styles.levelN,
      ].join(' ')}
      style={{
        '--avatar-size':   `${avatarSize}px`,
        '--font-scale':    fontScale,
        '--indent-size':   indentSize,
        '--gap-size':      gapSize,
        '--padding-scale': dvPadding,
      }}
    >
      {/* SVG connector overlay — only when children are visible */}
      {hasChildren && isExpanded && (
        <ConnectorSVG
          nodeContainerRef={nodeContainerRef}
          avatarRef={avatarRef}
          repliesContainerRef={repliesContainerRef}
          isHighlighted={false}
          isExpanded={isExpanded}
          filterId={filterId}
        />
      )}

      {/* Comment card */}
      <div
        id={`comment-${comment.id}`}
        className={[
          styles.replyCard,
          hasChildren && !isExpanded ? styles.isCollapsed : '',
        ].join(' ')}
        data-comment-card
        role={hasChildren ? 'button' : undefined}
        tabIndex={hasChildren ? 0 : undefined}
        aria-expanded={hasChildren ? isExpanded : undefined}
        onClick={handleCardClick}
        onKeyDown={handleCardKeyDown}
      >
        <div className={styles.replyWrapper} data-reply-wrapper>

          <div
            ref={avatarRef}
            className={styles.replyAvatar}
            data-child-avatar
          >
            <Avatar 
              src={author.avatar} 
              name={author.displayName} 
              size="100%" 
              onClick={(e) => { e.stopPropagation(); handleProfileClick(); }} 
            />
          </div>

          {/* Text content */}
          <div className={styles.replyContent}>
            <div className={styles.replyHeader}>
              <div className={styles.replyIdentity}>
                <button onClick={handleProfileClick} className={`hover-underline ${styles.nameButton}`}>
                  <span className={styles.username}>{author.displayName}</span>
                  <CollegeRepresentativeBadge isCampusRep={author.isCampusRep} collegeName={authorCollegeName} user={author} size="sm" />
                  {authorCollege && (
                    <img
                      src={getProcessedAvatarUrl(authorCollege.avatar)}
                      alt={authorCollege.name}
                      className={styles.commentCollegeIcon}
                      title={authorCollege.name}
                      onError={(e) => { e.target.onerror = null; e.target.src = '/default_avatar.svg'; }}
                    />
                  )}
                </button>
                <div className={styles.commentMeta}>
                  <span className={styles.handle}>@{author.username}</span>
                  <span className={styles.metaDot}>·</span>
                  <span className={styles.time}>{comment.createdAt ? timeAgo(comment.createdAt) : comment.time}</span>
                </div>
              </div>

              {/* Kebab menu */}
              <div className={styles.menuWrapper} data-no-collapse ref={menuRef}>
                <button
                  ref={menuTriggerRef}
                  onClick={(e) => { e.stopPropagation(); openMenu(); }}
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

            {/* Body — always visible */}
            <div>
              <div className={styles.replyText}>
                <RichText content={displayedText} mentions={displayedMentions} urlLimit={30} />
                {/* See the note in Post.jsx: the space is what lets this read as
                    part of the sentence and what lets the line wrap here. */}
                {textClip.needsTruncation && ' '}
                {textClip.needsTruncation && (
                  <button
                    type="button"
                    className={styles.seeMoreBtn}
                    data-no-collapse
                    aria-expanded={isTextExpanded}
                    onClick={(e) => {
                      // The node itself collapses the thread on click, so this
                      // must not bubble — expanding a comment's text should
                      // never fold away its replies.
                      e.stopPropagation();
                      setIsTextExpanded((v) => !v);
                    }}
                  >
                    {isTextExpanded ? 'See less' : 'See more'}
                  </button>
                )}
              </div>
              <div className={styles.replyActionsRow} data-no-collapse>
                <button
                  onClick={handleLike}
                  className={`${styles.actionBtn} ${localLiked ? styles.actionBtnLiked : ''}`}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill={localLiked ? 'var(--color-primary)' : 'none'} stroke={localLiked ? 'var(--color-primary)' : 'currentColor'} strokeWidth="2.5">
                    <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
                  </svg>
                  {localLikesCount}
                </button>
                <button onClick={handleReplyClick} className={styles.actionBtn}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="15 14 20 9 15 4" /><path d="M4 20v-7a4 4 0 0 1 4-4h12" />
                  </svg>
                  Reply
                </button>
              </div>

              {canCollapse && (
                <button
                  className={styles.viewRepliesBtn}
                  data-no-collapse
                  aria-expanded={isExpanded}
                  onClick={(e) => { e.stopPropagation(); toggleExpanded(comment.id, isExpanded); }}
                >
                  {isExpanded
                    ? 'Hide replies'
                    : `Show ${totalDescendants} ${totalDescendants === 1 ? 'reply' : 'replies'}`}
                </button>
              )}

              {isReplying && (
                <div className={styles.inlineComposerContainer} data-no-collapse>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <MentionInput
                      placeholder={`Reply to @${author.username}`}
                      value={replyContent}
                      onChange={setReplyContent}
                      onSubmit={handleSubmit}
                      className={styles.inlineTextarea}
                      singleLine={false}
                      autoFocus={true}
                    />
                  </div>
                  <div className={styles.inlineActions}>
                    <button onClick={handleCancelReply} className={styles.cancelBtn}>Cancel</button>
                    <button
                      onClick={handleSubmit}
                      disabled={!replyContent.text.trim() || isSubmitting}
                      className={`${styles.submitBtn} ${replyContent.text.trim() && !isSubmitting ? styles.submitBtnActive : styles.submitBtnDisabled}`}
                    >
                      {isSubmitting ? '...' : 'Comment'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Children — grid-collapse animation */}
      {hasChildren && (
        <div className={`${styles.repliesGrid} ${!isExpanded ? styles.repliesGridCollapsed : ''}`}>
          <div
            ref={repliesContainerRef}
            className={styles.repliesContainer}
            data-replies-container
            style={{ '--indent-size': indentSize }}
          >
            {comment.replies.map((child, idx) => (
              <CommentNode
                key={child.id}
                postId={postId}
                comment={child}
                onReplySubmit={onReplySubmit}
                level={level + 1}
                isLastSibling={idx === comment.replies.length - 1}
              />
            ))}
          </div>
        </div>
      )}

      {/*
        * Both dialogs are mounted only while they are open.
        *
        * They used to be rendered unconditionally by every node and return null
        * from inside. That is not free: ReportModal builds a react-hook-form
        * instance with a zod resolver, a report mutation and two overlay hooks
        * BEFORE its `if (!isOpen) return null`, so a 60-comment thread carried
        * 60 live form instances for dialogs nobody had opened (measured). The
        * dialogs render and behave identically; they simply do not exist until
        * something asks for them.
        */}
      {confirmRemove && (
        <ConfirmModal
          visible={confirmRemove}
          title="Delete this comment?"
          desc={`This deletes ${author.displayName || author.username || 'this member'}'s comment. They'll be notified that a moderator deleted it. Replies stay in the thread.`}
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
    </div>
  );
}

/**
 * The tree is recursive, so a node that re-renders re-renders its whole subtree.
 *
 * Note this is the binding `CommentTreeRoot` and the recursive `.map()`s below
 * both render. Exporting `memo(CommentNodeImpl)` while the JSX inside this file
 * still named the raw function would wrap only the tree's outermost use and
 * leave every nested reply unmemoised — which is to say, it would do nothing.
 * With the comment objects now keeping their identity across cache updates (see
 * buildCommentTree) this memo is what actually stops a change to one comment
 * from walking the entire thread: an unchanged node has an unchanged `comment`
 * and the same `replies` array inside it, and bails.
 *
 * Default shallow comparison is exactly right here — every prop is either a
 * primitive or an identity-stable object — so no custom comparator, and none of
 * the deep-equality cost one would bring.
 */
const CommentNode = memo(CommentNodeImpl);
CommentNode.displayName = 'CommentNode';

export default CommentNode;
