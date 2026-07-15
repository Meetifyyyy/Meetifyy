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

import { useState, useCallback, useEffect, useRef, useContext, createContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '@shared/context/DataContext';
import { showToast } from '@shared/utils/toast';
import { isImageUrl } from '@shared/utils/avatar';
import DefaultAvatar from '@shared/components/avatar/DefaultAvatar';
import MentionInput from '@shared/components/mentions/MentionInput';
import RichText from '@shared/components/mentions/RichText';
import { timeAgo } from '@shared/utils/time';
import styles from './CommentNode.module.css';

// ─── Shared tree context ─────────────────────────────────────────────────────
const TreeDensityContext = createContext({ tier: 'small', expandedMap: {}, toggleExpanded: () => {} });

function countVisibleNodes(comment, expandedMap) {
  let count = 1;
  if (comment.replies?.length && expandedMap[comment.id] !== false) {
    for (const child of comment.replies) count += countVisibleNodes(child, expandedMap);
  }
  return count;
}

// ─── Root wrapper ─────────────────────────────────────────────────────────────
export function CommentTreeRoot({ postId, comments, onReplySubmit }) {
  const [expandedMap, setExpandedMap] = useState({});

  const toggleExpanded = useCallback((id, currentVal) => {
    setExpandedMap(prev => ({ ...prev, [id]: !currentVal }));
  }, []);

  const totalVisible = comments.reduce((acc, c) => acc + countVisibleNodes(c, expandedMap), 0);
  const tier = totalVisible <= 5 ? 'small' : totalVisible <= 15 ? 'medium' : 'large';

  return (
    <TreeDensityContext.Provider value={{ tier, expandedMap, toggleExpanded }}>
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
    </TreeDensityContext.Provider>
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
export default function CommentNode({
  postId,
  comment,
  onReplySubmit,
  level = 0,
  isLastSibling = false,
}) {
  const [isReplying, setIsReplying]     = useState(false);
  const [replyContent, setReplyContent] = useState({ text: '', mentions: [] });
  const [showMenu, setShowMenu]         = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // DOM refs for SVG measurement
  const nodeContainerRef  = useRef(null);
  const avatarRef         = useRef(null);
  const repliesContainerRef = useRef(null);

  // Stable filter ID so inline SVG filter IDs don't collide across nodes
  const filterId = useRef(`cf-${comment.id}`.replace(/[^a-zA-Z0-9-]/g, '_')).current;

  const navigate = useNavigate();
  const { getUserById, likeComment, deleteComment, communities, currentUser } = useData();
  const { tier, expandedMap, toggleExpanded } = useContext(TreeDensityContext);

  const hasChildren = comment.replies?.length > 0;
  // Level 0 comments are expanded by default (unless explicitly closed)
  // Sub-comments (level > 0) are collapsed by default (unless explicitly opened)
  const isExpanded  = level === 0 
    ? expandedMap[comment.id] !== false 
    : expandedMap[comment.id] === true;

  const author = getUserById(comment.authorId) || { displayName: 'Unknown', username: 'unknown', avatar: '?' };
  const authorCollege = author.collegeId ? communities[author.collegeId] : null;
  const { likes, isLikedByMe: rawIsLiked } = comment;
  const isLikedByMe = comment.likedBy
    ? comment.likedBy.includes(currentUser?.id)
    : !!rawIsLiked;

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
  const handleProfileClick = () => navigate(`/profile/${author.username}`);
  const handleReplyClick   = () => { setIsReplying(r => !r); setReplyContent({ text: '', mentions: [] }); };
  const handleCancelReply  = () => { setIsReplying(false); setReplyContent({ text: '', mentions: [] }); };
  const handleLike         = () => likeComment(postId, comment.id);

  const handleSubmit = async () => {
    if (!replyContent.text.trim() || isSubmitting) return;
    setIsSubmitting(true);
    await onReplySubmit(comment.id, replyContent.text, replyContent.mentions);
    setIsSubmitting(false);
    setIsReplying(false);
    setReplyContent({ text: '', mentions: [] });
  };

  const handleCardClick = (e) => {
    if (e.target.closest('[data-no-collapse]')) return;
    if (!hasChildren) return;
    toggleExpanded(comment.id, isExpanded);
  };

  const handleCardKeyDown = (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && hasChildren) {
      e.preventDefault();
      toggleExpanded(comment.id, isExpanded);
    }
  };

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

          {/* Avatar — tagged so parent ConnectorSVG can locate it */}
          <div
            ref={avatarRef}
            className={styles.replyAvatar}
            data-child-avatar
            onClick={(e) => { e.stopPropagation(); handleProfileClick(); }}
          >
            {isImageUrl(author.avatar) ? (
              <img src={author.avatar} alt={author.displayName} className={styles.replyAvatarImg} />
            ) : (
              <DefaultAvatar />
            )}
          </div>

          {/* Text content */}
          <div className={styles.replyContent}>
            <div className={styles.replyHeader}>
              <div className={styles.replyIdentity}>
                <button onClick={handleProfileClick} className={`hover-underline ${styles.nameButton}`}>
                  <span className={styles.username}>{author.displayName}</span>
                  {authorCollege && (
                    <img
                      src={authorCollege.avatar}
                      alt={authorCollege.name}
                      className={styles.commentCollegeIcon}
                      title={authorCollege.name}
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
              <div className={styles.menuWrapper} data-no-collapse>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowMenu(s => !s); }}
                  className={styles.menuBtn}
                  aria-label="More options"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /><circle cx="5" cy="12" r="1.5" />
                  </svg>
                </button>
                {showMenu && (
                  <div className="dropdown open" style={{ right: 0, top: '100%', width: '120px' }}>
                    {currentUser && comment.authorId === currentUser.id && (
                      <button
                        onClick={async (e) => { e.stopPropagation(); setShowMenu(false); if (deleteComment) await deleteComment(postId, comment.id); }}
                        style={{ color: 'var(--color-danger)' }}
                        className={styles.reportBtn}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                        Delete Comment
                      </button>
                    )}
                    {(!currentUser || comment.authorId !== currentUser.id) && (
                      <button
                        onClick={(e) => { e.stopPropagation(); showToast('Reported'); setShowMenu(false); }}
                        style={{ color: 'var(--color-text-main)' }}
                        className={styles.reportBtn}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" y1="22" x2="4" y2="15" />
                        </svg>
                        Report
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Body — always visible */}
            <div>
              <div className={styles.replyText}>
                <RichText content={comment.text} mentions={comment.mentions} urlLimit={30} />
              </div>
              <div className={styles.replyActionsRow} data-no-collapse>
                <button
                  onClick={handleLike}
                  className={`${styles.actionBtn} ${isLikedByMe ? styles.actionBtnLiked : ''}`}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill={isLikedByMe ? 'var(--color-primary)' : 'none'} stroke={isLikedByMe ? 'var(--color-primary)' : 'currentColor'} strokeWidth="2.5">
                    <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
                  </svg>
                  {likes}
                </button>
                <button onClick={handleReplyClick} className={styles.actionBtn}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="15 14 20 9 15 4" /><path d="M4 20v-7a4 4 0 0 1 4-4h12" />
                  </svg>
                  Reply
                </button>
              </div>

              {!isExpanded && hasChildren && (() => {
                const countAllReplies = (node) => {
                  if (!node.replies) return 0;
                  return node.replies.reduce((acc, reply) => acc + 1 + countAllReplies(reply), 0);
                };
                const totalReplies = countAllReplies(comment);
                return (
                  <button
                    className={styles.viewRepliesBtn}
                    data-no-collapse
                    onClick={(e) => { e.stopPropagation(); toggleExpanded(comment.id, isExpanded); }}
                  >
                    View {totalReplies} {totalReplies === 1 ? 'reply' : 'replies'}
                  </button>
                );
              })()}

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
    </div>
  );
}
