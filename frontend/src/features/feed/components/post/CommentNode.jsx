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

import { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useContext, createContext, useSyncExternalStore, memo } from 'react';
import { useNavigate } from 'react-router-dom';

import { showToast } from '@shared/utils/toast';
import { isImageUrl } from '@shared/utils/avatar';
import DefaultAvatar from '@shared/components/avatar/DefaultAvatar';
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
import { createPortal } from 'react-dom';


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
  }, [measure]);

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
  const portalMenuRef = useRef(null);
  // Tracks which menuPos object the clamp effect below has already handled, so
  // it corrects a position once per open and can never re-enter.
  const clampedForRef = useRef(null);
  const [menuPos, setMenuPos] = useState(null);
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
  const { mutate: toggleLike, isLoading: isLiking } = useLikeComment();
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
    if (showMenu) { setShowMenu(false); return; }

    // First-paint estimate only — the real size is measured and corrected in
    // the layout effect below. `.dropdown` carries `min-width: 160px`, so an
    // assumed 120 positioned the menu as if it were narrower than it renders
    // and pushed it off the right edge on a phone.
    const MENU_W = 160;
    const MENU_H = 120;
    const GAP = 8;
    const rect = menuRef.current?.getBoundingClientRect();
    if (rect) {
      const vh = window.visualViewport?.height || window.innerHeight;
      const vw = window.visualViewport?.width || window.innerWidth;
      const spaceBelow = vh - rect.bottom;
      // Flip only when below is genuinely too tight AND above has more room,
      // so a menu near the top of a short viewport does not flip into the
      // header instead.
      const flip = spaceBelow < MENU_H + GAP && rect.top > spaceBelow;

      const top = flip ? Math.max(GAP, rect.top - MENU_H - GAP) : rect.bottom + GAP;
      // Right-aligned to the button, then clamped so a deeply indented comment
      // (whose button sits far right) cannot push it past either edge.
      const left = Math.min(Math.max(GAP, rect.right - MENU_W), vw - MENU_W - GAP);
      setMenuPos({ top, left });
    }
    setShowMenu(true);
  }, [showMenu, setShowMenu]);

  /**
   * Correct the position against the menu's REAL size, once it exists.
   *
   * Positioning from an assumed width is guesswork, and it was wrong: the
   * shared `.dropdown` class sets `min-width: 160px`, which beat the inline
   * width, so the menu rendered wider than it was placed for and hung off the
   * right edge of a phone screen. Measuring the mounted element removes the
   * assumption entirely — whatever the class, the padding or the longest label
   * turn out to be, it ends up inside the viewport.
   *
   * Clamped, not re-anchored, so it stays visually attached to its button.
   *
   * Measured with offsetWidth/offsetHeight, NOT getBoundingClientRect: the
   * shared `.dropdown` class opens with a 0.2s `transform: scale()` transition,
   * and the client rect reports the *transformed* box, so it reported a
   * different size on every frame of that animation. Each pass then produced a
   * different clamp, re-rendered, re-measured a still-animating menu and looped
   * synchronously until React threw "Maximum update depth exceeded" (#185).
   * The offset box is the untransformed layout size, so it is stable and the
   * comparison guard below genuinely terminates after one correction.
   *
   * `clampedForRef` additionally makes this run at most once per open, so no
   * later re-render can restart the cycle.
   */
  useLayoutEffect(() => {
    if (!showMenu) { clampedForRef.current = null; return; }
    if (!menuPos || !portalMenuRef.current) return;
    if (clampedForRef.current === menuPos) return;
    clampedForRef.current = menuPos;
    const GAP = 8;
    const el = portalMenuRef.current;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.visualViewport?.width || window.innerWidth;
    const vh = window.visualViewport?.height || window.innerHeight;

    const left = Math.min(Math.max(GAP, menuPos.left), Math.max(GAP, vw - w - GAP));
    const top = Math.min(Math.max(GAP, menuPos.top), Math.max(GAP, vh - h - GAP));
    if (left !== menuPos.left || top !== menuPos.top) setMenuPos({ top, left });
  }, [showMenu, menuPos]);

  // Dismiss on anything that would leave it stranded: a click elsewhere, or
  // any scroll/resize, since the position was measured once and does not track.
  useEffect(() => {
    if (!showMenu) return undefined;
    const close = (e) => {
      if (e && menuRef.current?.contains(e.target)) return;
      if (e && portalMenuRef.current?.contains(e.target)) return;
      setShowMenu(false);
    };
    const closeNow = () => setShowMenu(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close, { passive: true });
    window.addEventListener('scroll', closeNow, true);
    window.addEventListener('resize', closeNow);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close);
      window.removeEventListener('scroll', closeNow, true);
      window.removeEventListener('resize', closeNow);
    };
  }, [showMenu, setShowMenu]);

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
                  onClick={(e) => { e.stopPropagation(); openMenu(); }}
                  className={styles.menuBtn}
                  aria-expanded={showMenu}
                  aria-label="More options"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /><circle cx="5" cy="12" r="1.5" />
                  </svg>
                </button>
                {showMenu && menuPos && createPortal(
                  <div
                    ref={portalMenuRef}
                    className="dropdown open"
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      position: 'fixed',
                      top: menuPos.top,
                      left: menuPos.left,
                      // `.dropdown` is written for an absolutely-positioned menu
                      // anchored to its button and carries `right: 0`. Left as-is,
                      // a fixed element with BOTH `left` (below) and `right` set
                      // and `width: auto` stretches to span the whole gap between
                      // them -- which is why this menu rendered as a full-width
                      // bar instead of hugging its one "Report" item. Clearing
                      // `right` and sizing to `max-content` makes it shrink-wrap.
                      right: 'auto',
                      width: 'max-content',
                      maxWidth: 'min(260px, calc(100vw - 16px))',
                      // Above the comment tree and the post card, but below the
                      // app's real modals so a confirm dialog still covers it.
                      zIndex: 4000,
                    }}
                  >
              {canDeleteComment && (
                        <button
                          onClick={handleDelete}
                          disabled={isDeleting}
                          style={{ color: isDeleting ? 'var(--color-text-muted)' : 'var(--color-danger)', opacity: isDeleting ? 0.6 : 1 }}
                          className={styles.reportBtn}
                        >
                          {isDeleting ? (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 0.8s linear infinite' }}>
                              <circle cx="12" cy="12" r="10" strokeOpacity="0.3" />
                              <path d="M12 2a10 10 0 0 1 10 10" />
                            </svg>
                          ) : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                          )}
                          {isDeleting ? 'Deleting…' : 'Delete'}
                        </button>
                      )}
                    {(!currentUser || comment.authorId !== currentUser.id) && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowMenu(false);
                          if (!hasReported) setShowReportModal(true);
                        }}
                        style={{ color: hasReported ? 'var(--color-text-muted)' : 'var(--color-text-main)' }}
                        className={styles.reportBtn}
                        disabled={hasReported}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" y1="22" x2="4" y2="15" />
                        </svg>
                        {hasReported ? 'Already Reported' : 'Report'}
                      </button>
                    )}
                  </div>,
                  document.body,
                )}
              </div>
            </div>

            {/* Body — always visible */}
            <div>
              <div className={styles.replyText}>
                <RichText content={displayedText} mentions={displayedMentions} urlLimit={30} />
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
