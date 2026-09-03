import { useState, useEffect, memo, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { isImageUrl } from '@shared/utils/avatar';
import { sanitizeUrl } from '@shared/utils/urlSanitize';
import Avatar, { getProcessedAvatarUrl } from '@shared/components/avatar/Avatar';
import { CollegeRepresentativeBadge } from '@shared/components/badges/CollegeRepresentativeBadge';
import { getCollegeName } from '@shared/utils/user';
import RichText from '@shared/components/mentions/RichText';
import { normalizeBodyText, truncateBodyText, clipMentions, POST_LIMITS } from '@shared/utils/bodyText';
import { useAuth } from '@shared/context/AuthContext';
import { useCommunities } from '@shared/hooks/useCommunities';
import { timeAgo } from '@shared/utils/time';
import styles from './Post.module.css';
import PostActions from './PostActions';
import { useMediaViewerActions } from '@shared/context/MediaViewerContext';
import ConfirmModal from '@shared/components/modals/ConfirmModal';
import ReportModal from '@shared/components/modals/ReportModal/ReportModal';
import MediaGrid from './MediaGrid';
import { useDeletePost } from '../../hooks/useDeletePost';
import { useVotePoll } from '../../hooks/useVotePoll';
import { getMediaUrl } from '@shared/api/apiClient';

function PollCard({ poll, postId }) {
  const { currentUser } = useAuth();
  const { mutate: voteInPoll, isLoading: isSubmitting } = useVotePoll();

  // Derive voted state and votes from the shared poll object
  const optionsList = Array.isArray(poll.options) ? poll.options : [];
  const derivedVotedIndex = poll.votedOptionIndex !== undefined && poll.votedOptionIndex !== null && poll.votedOptionIndex >= 0
    ? poll.votedOptionIndex
    : (poll.userVotedOptionId ? optionsList.findIndex(o => (typeof o === 'object' ? o.id : null) === poll.userVotedOptionId) : -1);

  const rawMyVotes = poll.selectedUsers?.[currentUser?.id] || poll.myVotes;
  const myVotes = Array.isArray(rawMyVotes) && rawMyVotes.length > 0
    ? rawMyVotes
    : (derivedVotedIndex >= 0 ? [derivedVotedIndex] : []);

  const hasVoted = myVotes.length > 0;

  const rawVotes = Array.isArray(poll.votes) ? poll.votes : null;
  const votes = rawVotes
    ? rawVotes.map(v => (typeof v === 'object' && v !== null ? Number(v.votes ?? v.voteCount ?? v._count?.votes ?? 0) : Number(v) || 0))
    : optionsList.map(opt => (typeof opt === 'object' ? Number(opt.votes ?? opt.voteCount ?? opt._count?.votes ?? 0) : 0));
  const totalVotes = poll.totalVotes !== undefined && poll.totalVotes !== null ? poll.totalVotes : votes.reduce((a, b) => a + b, 0);

  // Local state only for multi-select pre-submission selection
  const [pendingSelection, setPendingSelection] = useState([]);

  const handleVote = (idx) => {
    if (hasVoted || isSubmitting) return;

    if (poll.multiSelect) {
      setPendingSelection((prev) =>
        prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]
      );
    } else {
      voteInPoll({ postId, indices: [idx], currentUserId: currentUser?.id });
    }
  };

  const confirmMultiVote = () => {
    if (pendingSelection.length === 0 || hasVoted || isSubmitting) return;
    voteInPoll({ postId, indices: pendingSelection, currentUserId: currentUser?.id });
    setPendingSelection([]);
  };

  const showResults = hasVoted;
  const selected = hasVoted ? myVotes : pendingSelection;

  return (
    <div className={styles.pollCard}>
      <div className={styles.pollCardOptions}>
        {optionsList.map((opt, i) => {
          const getOptionText = (o) => {
            if (!o) return '';
            if (typeof o === 'string') return o;
            if (typeof o === 'number') return String(o);
            if (typeof o === 'object') {
              if (typeof o.text === 'string') return o.text;
              if (typeof o.label === 'string') return o.label;
              if (typeof o.title === 'string') return o.title;
              if (typeof o.question === 'string') return o.question;
              if (o.text && typeof o.text === 'object') return getOptionText(o.text);
              if (o.label && typeof o.label === 'object') return getOptionText(o.label);
              if (o.title && typeof o.title === 'object') return getOptionText(o.title);
            }
            return '';
          };
          const optText = getOptionText(opt);
          const pct = showResults && totalVotes > 0 ? Math.round(((votes[i] || 0) / totalVotes) * 100) : 0;
          const isSelected = selected.includes(i);

          return (
            <button
              key={typeof opt === 'object' && opt.id ? opt.id : i}
              className={`${styles.pollCardOption}${isSelected ? ` ${styles.selected}` : ''}${showResults ? ` ${styles.voted}` : ''}`}
              onClick={() => handleVote(i)}
              disabled={showResults || isSubmitting}
            >
              <div className={styles.pollOptionFill} style={{ width: showResults ? `${pct}%` : '0%' }} />
              <span className={styles.pollOptionLabel}>
                {poll.multiSelect && !showResults && (
                  <span className={`${styles.pollCheckbox}${isSelected ? ` ${styles.checked}` : ''}`}>
                    {isSelected && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5"><polyline points="20 6 9 17 4 12" /></svg>}
                  </span>
                )}
                {optText}
              </span>
              {showResults && <span className={styles.pollOptionPct}>{pct}%</span>}
            </button>
          );
        })}
      </div>
      <div className={styles.pollCardFooter}>
        {poll.multiSelect && <span className={styles.pollMultiBadge}>Multi</span>}
        {poll.multiSelect && !hasVoted && pendingSelection.length > 0 && (
          <button className={styles.pollConfirmBtn} onClick={confirmMultiVote} disabled={isSubmitting}>Confirm</button>
        )}
        <span className={styles.pollVoteCount}>{totalVotes} {totalVotes === 1 ? 'vote' : 'votes'}</span>
      </div>
    </div>
  );
}


function Post({ postData, onClick, onDeleted, isDetailed = false, hideCommunityTag = false }) {
  const { currentUser } = useAuth();
  const { communitiesById } = useCommunities();
  const { openViewer } = useMediaViewerActions();
  const [showMenu, setShowMenu] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [hasReported, setHasReported] = useState(false);

  const id = postData?.id;

  const { mutate: deletePost } = useDeletePost();

  useEffect(() => {
    if (!showMenu) return;
    const handleOutsideClick = () => setShowMenu(false);
    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, [showMenu]);

  useEffect(() => {
    const handleCloseOthers = (e) => {
      if (e.detail?.postId !== id) {
        setShowMenu(false);
      }
    };
    window.addEventListener('close-all-post-menus', handleCloseOthers);
    return () => window.removeEventListener('close-all-post-menus', handleCloseOthers);
  }, [id]);

  const { authorId, time, text, mentions, poll } = postData || {};

  /**
   * Normalise and clip once per render, not twice.
   *
   * The text block and the media block below both needed the answer to "is this
   * body long enough to collapse?", and each computed it from scratch — so
   * `normalizeBodyText` + `truncateBodyText` ran twice over every post body on
   * every render, and the media block threw its copy away after reading one
   * boolean off it.
   */
  const body = useMemo(() => {
    if (!text) return null;
    const normalized = normalizeBodyText(text);
    return { normalized, clip: truncateBodyText(normalized, POST_LIMITS) };
  }, [text]);

  const author = useMemo(
    () => postData?.author || { id: authorId, displayName: 'User', username: 'user', avatar: null },
    [postData?.author, authorId],
  );

  const handleCardClick = useCallback(() => {
    if (isDetailed) return;
    if (onClick) onClick(postData);
  }, [isDetailed, onClick, postData]);

  /**
   * Stable, so the memo on <PostActions> can actually hold.
   *
   * This was an inline arrow, which meant PostActions received a brand-new
   * `onCommentClick` on every render of this card and re-rendered its four
   * buttons and their SVGs every time — `memo(PostActions)` never once bailed.
   */
  const handleCommentClick = useCallback(() => {
    if (onClick) onClick(postData);
  }, [onClick, postData]);

  /**
   * Also stable, for the same reason: MediaGrid is memoised and an inline
   * handler defeated it.
   */
  const handleMediaClick = useCallback((items, index) => {
    openViewer(items, index, {
      authorName: author.displayName,
      authorAvatar: author.avatar,
      authorUsername: author.username,
      timestamp: postData.createdAt ? new Date(postData.createdAt).toLocaleString() : time,
      source: 'Post',
      isOwner: currentUser?.id === authorId,
      post: postData,
      author,
    });
  }, [openViewer, author, postData, time, currentUser?.id, authorId]);

  // Every hook is above this line; the guard cannot change hook order.
  if (!postData) return null;

  const isOwnPost = Boolean(currentUser && authorId === currentUser.id);

  /**
   * Whether to offer removal — the server's answer, not our own.
   *
   * `canDelete` comes from the same authorizer the DELETE endpoint enforces
   * with, so a community owner and a moderator see the control on content they
   * are actually allowed to remove. Re-deriving the role rules here would put a
   * second copy of an authorization rule in the one place that cannot enforce
   * it, and the copies would drift.
   *
   * Falls back to authorship for a payload from an older server, which is the
   * safe direction: it under-offers rather than showing a control the API would
   * refuse anyway.
   */
  const canDeletePost = postData?.canDelete ?? isOwnPost;

  /**
   * Removing someone else's post is a different act from deleting your own,
   * and the UI should say so.
   *
   * The label stays "Delete" either way — that is the app's word for this
   * action everywhere else, and inventing a second verb for the same button
   * just makes moderators wonder whether it does something different. Only
   * the confirmation copy changes, to name whose post it is and to say the
   * author will be told. A moderator should not learn that a notification
   * went out by hearing about it from the author.
   */
  const isModeratingOthers = canDeletePost && !isOwnPost;
  const authorCollege = (author.collegeId && communitiesById) ? communitiesById[author.collegeId] : null;
  const authorCollegeName = getCollegeName(author, '') || authorCollege?.name || '';

  const formatExactDate = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return `${timeStr} · ${dateStr}`;
  };

  const exactTimeStr = postData.createdAt ? formatExactDate(postData.createdAt) : time;


  // The post now carries its own community from the API, which is the only
  // source that is always right. `communitiesById` is a fallback for cached
  // posts written before that field existed — it is built from the user's
  // community list, which the API paginates to 30, so relying on it alone
  // meant posts from a user's 31st community rendered with no tag at all.
  const postCommunity = hideCommunityTag
    ? null
    : (postData.community
        || (postData.communityId && communitiesById ? communitiesById[postData.communityId] : null)
        || null);

  return (
    <div className={styles.post} onClick={handleCardClick} style={{ cursor: (!isDetailed && onClick) ? 'pointer' : 'default' }}>
      <div className={styles.postHeader}>
        <div className={styles.postAvatarContainer}>
          <Link to={`/profile/${author.username}`} style={{ textDecoration: 'none' }} onClick={(e) => e.stopPropagation()}>
            <div className={styles.postAvatar}>
              <Avatar src={author.avatar} name={author.displayName} size="100%" />
            </div>
          </Link>
          {postCommunity && (
            <Link 
              to={`/communities/${postCommunity.id}`} 
              className={styles.communityBadgeOverlay}
              onClick={(e) => e.stopPropagation()}
              title={postCommunity.name}
              style={{ background: (!isImageUrl(postCommunity.avatar)) ? (postCommunity.color || 'var(--color-primary)') : 'var(--color-bg-white)' }}
            >
              {isImageUrl(postCommunity.avatar) ? (
                <img src={getProcessedAvatarUrl(postCommunity.avatar)} alt="" loading="lazy" onError={(e) => { e.target.onerror = null; e.target.src = '/default_avatar.svg'; }} />
              ) : (
                <span>{postCommunity.avatar || postCommunity.name?.charAt(0).toUpperCase()}</span>
              )}
            </Link>
          )}
        </div>
        <div className={styles.postUser}>
          <Link to={`/profile/${author.username}`} style={{ textDecoration: 'none', color: 'inherit', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }} onClick={(e) => e.stopPropagation()}>
            <div className={`hover-underline ${styles.postName}`}>{author.displayName}</div>
            <CollegeRepresentativeBadge isCampusRep={author.isCampusRep} collegeName={authorCollegeName} user={author} size="md" />

            {authorCollege && (
              <img
                src={getProcessedAvatarUrl(authorCollege.avatar)}
                alt={authorCollege.name}
                loading="lazy"
                className={styles.postCollegeIcon}
                title={authorCollege.name}
                onError={(e) => { e.target.onerror = null; e.target.src = '/default_avatar.svg'; }}
              />
            )}
          </Link>
          <div className={styles.postTime} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
            {postCommunity ? (
              <Link 
                to={`/communities/${postCommunity.id}`} 
                className={styles.communityNameLink}
                onClick={(e) => e.stopPropagation()}
              >
                {postCommunity.name}
              </Link>
            ) : (
              <span className={styles.postUsername}>@{author.username}</span>
            )}
            <span className={styles.postTimeDot}>·</span>
            <span>{postData.createdAt ? timeAgo(postData.createdAt) : (time ? timeAgo(time) : '')}</span>
          </div>
        </div>

        <div className={styles.postMenuWrapper}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              const nextState = !showMenu;
              setShowMenu(nextState);
              if (nextState) {
                window.dispatchEvent(new CustomEvent('close-all-post-menus', { detail: { postId: id } }));
              }
            }}
            aria-label="Post options"
            className={styles.menuBtn}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="1" />
              <circle cx="19" cy="12" r="1" />
              <circle cx="5" cy="12" r="1" />
            </svg>
          </button>
          {showMenu && (
            <div className="dropdown open" style={{ right: 0, top: '100%', width: '140px' }} onClick={(e) => e.stopPropagation()}>
              {canDeletePost && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowMenu(false);
                    setShowDeleteConfirm(true);
                  }}
                  style={{ color: 'var(--color-danger)', display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%' }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                  Delete Post
                </button>
              )}
              {!isOwnPost && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowMenu(false);
                    if (!hasReported) {
                      setShowReportModal(true);
                    }
                  }}
                  style={{ color: hasReported ? 'var(--color-text-muted)' : 'var(--color-text-main)', display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%' }}
                  disabled={hasReported}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line></svg>
                  {hasReported ? 'Already Reported' : 'Report'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {body && (() => {
        const { normalized: normalizedText, clip } = body;
        // The detail page is the place the whole post is meant to be read, so
        // nothing is clipped there however long it runs.
        const needsTruncation = clip.needsTruncation && !isDetailed;
        const collapsed = needsTruncation && !isExpanded;

        const displayedText = collapsed ? clip.text : normalizedText;
        const displayedMentions = collapsed ? clipMentions(mentions, displayedText) : mentions;

        return (
          <div className={`${styles.postBody} ${isDetailed ? styles.selectableText : ''}`}>
            <RichText content={displayedText} mentions={displayedMentions} urlLimit={isDetailed ? 50 : 35} />
            {needsTruncation && (
              <div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsExpanded(!isExpanded);
                  }}
                  className={styles.seeMoreBtn}
                >
                  {isExpanded ? 'See less' : 'See more'}
                </button>
              </div>
            )}
          </div>
        );
      })()}

      {/*
        * Attachments render on their own terms, never on the text's.
        *
        * This block used to be gated on the same `needsTruncation` flag as the
        * body copy: a post whose caption ran past the clip limit had its media,
        * its link preview AND its poll collapsed to `max-height: 0;
        * visibility: hidden` until the reader pressed "See more". The intent was
        * a compact card, but the effect was that a photo posted with a long
        * caption looked like a post with no photo, and a poll looked like it had
        * no options. "See more" is a control over text; it was silently deciding
        * whether the actual content of the post appeared at all.
        *
        * Nothing here reads the text state now, so there is no path by which a
        * caption's length can hide an attachment. Expanding or collapsing the
        * copy above reflows this block downwards, which is ordinary document
        * flow, and cannot make it disappear or re-mount.
        */}
      {(postData.media || postData.linkPreview || poll) && (
        <div className={styles.postAttachments}>
          {postData.media && (
            <MediaGrid
              media={postData.media}
              onMediaClick={handleMediaClick}
            />
          )}
          {postData.linkPreview && (
            <a
              href={sanitizeUrl(postData.linkPreview.url)}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.linkPreview}
              onClick={(e) => e.stopPropagation()}
            >
              {postData.linkPreview.image && (
                <img
                  src={getMediaUrl(postData.linkPreview.image)}
                  alt=""
                  loading="lazy"
                  className={styles.linkPreviewImg}
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              )}
              <div className={styles.linkPreviewBody}>
                {postData.linkPreview.site && (
                  <span className={styles.linkPreviewSite}>{postData.linkPreview.site}</span>
                )}
                <span className={styles.linkPreviewTitle}>{postData.linkPreview.title}</span>
                {postData.linkPreview.description && (
                  <span className={styles.linkPreviewDesc}>{postData.linkPreview.description}</span>
                )}
              </div>
            </a>
          )}
          {poll && <div onClick={(e) => e.stopPropagation()}><PollCard poll={poll} postId={id} /></div>}
        </div>
      )}

      {isDetailed && exactTimeStr && (
        <div className={styles.postExactTime}>
          {exactTimeStr}
        </div>
      )}

      <PostActions
        post={postData}
        authorOverride={author}
        onCommentClick={handleCommentClick}
      />

      {showDeleteConfirm && (
        <div onClick={(e) => e.stopPropagation()}>
          <ConfirmModal
            title="Delete Post"
            desc={
              isModeratingOthers
                ? `This deletes ${author?.displayName || author?.username || 'this member'}'s post. They'll be notified that a moderator deleted it.`
                : 'This post will be permanently removed.'
            }
            visible={showDeleteConfirm}
            onCancel={() => setShowDeleteConfirm(false)}
            onConfirm={() => {
              setShowDeleteConfirm(false);
              deletePost({ postId: id });
              if (isDetailed && onDeleted) onDeleted();
            }}
            confirmText="Delete"
            cancelText="Cancel"
            isDestructive={true}
          />
        </div>
      )}

      {showReportModal && (
        <ReportModal
          isOpen={showReportModal}
          onClose={() => setShowReportModal(false)}
          targetType="POST"
          targetId={id}
          targetPreview={text?.slice(0, 80)}
          targetName={author?.displayName || author?.username}
          targetAvatar={author?.avatar}
          reportedFrom="feed"
          onSubmitted={() => setHasReported(true)}
        />
      )}
    </div>
  );
}

function arePostPropsEqual(prevProps, nextProps) {
  if (prevProps.isDetailed !== nextProps.isDetailed) return false;
  if (prevProps.hideCommunityTag !== nextProps.hideCommunityTag) return false;
  if (prevProps.onClick !== nextProps.onClick) return false;
  if (prevProps.onDeleted !== nextProps.onDeleted) return false;

  const prev = prevProps.postData;
  const next = nextProps.postData;
  if (prev === next) return true;
  if (!prev || !next) return false;
  if (prev.id !== next.id) return false;
  if (prev.text !== next.text) return false;
  // The community tag is part of what this card renders, so a post that
  // gains its community (a cached row refetched with the field populated)
  // has to re-render — otherwise the tag never appears.
  if (prev.communityId !== next.communityId) return false;
  if (prev.community?.id !== next.community?.id) return false;
  if (prev.community?.name !== next.community?.name) return false;
  if (prev.likeCount !== next.likeCount || prev.likesCount !== next.likesCount) return false;
  if (prev.commentCount !== next.commentCount || prev.commentsCount !== next.commentsCount) return false;
  if (prev.isLiked !== next.isLiked || prev.hasLiked !== next.hasLiked || prev.isLikedByMe !== next.isLikedByMe) return false;
  if (prev.isBookmarked !== next.isBookmarked || prev.hasBookmarked !== next.hasBookmarked) return false;
  if (prev.updatedAt !== next.updatedAt) return false;
  // `JSON.stringify` used to decide these three.
  //
  // It is correct but it is the most expensive thing this comparator could do,
  // and it runs on the render path: a refetch replaces every post object, so a
  // window-focus revalidation serialised the media list, the poll and the
  // author of every card on screen — and did it again on the next commit. The
  // field-level comparisons below answer the same question by reading the
  // handful of properties this card actually renders.
  if (!sameMedia(prev.media, next.media)) return false;
  if (!samePoll(prev.poll, next.poll)) return false;
  if (!sameAuthor(prev.author, next.author)) return false;
  return true;
}

/** The media properties MediaGrid lays out and loads. */
function sameMedia(a, b) {
  if (a === b) return true;
  const listA = Array.isArray(a) ? a : [];
  const listB = Array.isArray(b) ? b : [];
  if (listA.length !== listB.length) return false;
  for (let i = 0; i < listA.length; i++) {
    const x = listA[i] || {};
    const y = listB[i] || {};
    if (x === y) continue;
    if (x.url !== y.url || x.thumb !== y.thumb || x.type !== y.type
      || x.width !== y.width || x.height !== y.height
      || x.aspectRatio !== y.aspectRatio) return false;
  }
  return true;
}

/** The poll properties PollCard renders — options, their counts and the vote. */
function samePoll(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.multiSelect !== b.multiSelect) return false;
  if (a.totalVotes !== b.totalVotes) return false;
  if (a.votedOptionIndex !== b.votedOptionIndex) return false;
  if (a.userVotedOptionId !== b.userVotedOptionId) return false;
  // `myVotes`/`selectedUsers` decide whether results are shown at all, so a
  // change to either has to re-render even when the totals happen to match.
  if (a.myVotes !== b.myVotes) return false;
  if (a.selectedUsers !== b.selectedUsers) return false;
  const optsA = Array.isArray(a.options) ? a.options : [];
  const optsB = Array.isArray(b.options) ? b.options : [];
  if (optsA.length !== optsB.length) return false;
  for (let i = 0; i < optsA.length; i++) {
    const x = optsA[i];
    const y = optsB[i];
    if (x === y) continue;
    if (typeof x !== 'object' || typeof y !== 'object' || !x || !y) return false;
    if (x.id !== y.id || x.text !== y.text || x.label !== y.label
      || x.votes !== y.votes || x.voteCount !== y.voteCount) return false;
  }
  return true;
}

/** The author fields this card puts on screen. */
function sameAuthor(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.id === b.id
    && a.displayName === b.displayName
    && a.username === b.username
    && a.avatar === b.avatar
    && a.collegeId === b.collegeId
    && a.isCampusRep === b.isCampusRep;
}

export default memo(Post, arePostPropsEqual);
