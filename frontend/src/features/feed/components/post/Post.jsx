import { useState, useEffect, memo, useCallback } from 'react';
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
import SharePostModal from '../modals/SharePostModal';
import { useMediaViewer } from '@shared/context/MediaViewerContext';
import ConfirmModal from '@shared/components/modals/ConfirmModal';
import ReportModal from '@shared/components/modals/ReportModal/ReportModal';
import MediaGrid from './MediaGrid';
import { useLikePost } from '../../hooks/useLikePost';
import { useSavePost } from '../../hooks/useSavePost';
import { useDeletePost } from '../../hooks/useDeletePost';
import { useVotePoll } from '../../hooks/useVotePoll';
import { toggleRegistry } from '@shared/utils/mutationRegistry';
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
  const { openViewer } = useMediaViewer();
  const [showMenu, setShowMenu] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [hasReported, setHasReported] = useState(false);

  const id = postData?.id;

  const { mutate: toggleLike } = useLikePost();
  const { mutate: toggleSave } = useSavePost();
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

  if (!postData) return null;

  const { authorId, time, text, mentions, poll, likeCount, commentCount, hasLiked, isLiked, isLikedByMe: rawIsLiked, isBookmarked: rawIsBookmarked, hasBookmarked } = postData;

  const rawIsLikedByMe = hasLiked !== undefined ? !!hasLiked : (isLiked !== undefined ? !!isLiked : (rawIsLiked !== undefined ? !!rawIsLiked : (postData.likedBy ? postData.likedBy.includes(currentUser?.id) : false)));
  const isLikedByMe = toggleRegistry.getLatestIntent(`likePost:${id}`, rawIsLikedByMe);

  const likes = likeCount !== undefined ? likeCount : (postData.likesCount !== undefined ? postData.likesCount : (postData.likes || 0));
  const comments = commentCount !== undefined ? commentCount : (postData.commentsCount !== undefined ? postData.commentsCount : (postData.comments || 0));

  const rawIsSaved = hasBookmarked !== undefined ? !!hasBookmarked : !!rawIsBookmarked;
  const isSaved = toggleRegistry.getLatestIntent(`savePost:${id}`, rawIsSaved);

  const author = postData.author || { id: authorId, displayName: 'User', username: 'user', avatar: null };

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

  const handleCardClick = () => {
    if (isDetailed) return;
    if (onClick) onClick(postData);
  };

  const toggleLikeHandler = (e) => {
    e.stopPropagation();
    const entityKey = `likePost:${id}`;
    const nextLiked = toggleRegistry.getNextToggleIntent(entityKey, isLikedByMe);
    toggleLike({ postId: id, isLiked: nextLiked });
  };

  const handleShare = (e) => {
    e.stopPropagation();
    e.preventDefault();
    setShowShareModal(true);
  };

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
                <img src={getProcessedAvatarUrl(postCommunity.avatar)} alt="" loading="lazy" onError={(e) => { e.target.onerror = null; e.target.src = '/default_avatar.webp'; }} />
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
                onError={(e) => { e.target.onerror = null; e.target.src = '/default_avatar.webp'; }}
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

      {text && (() => {
        const normalizedText = normalizeBodyText(text);
        const clip = truncateBodyText(normalizedText, POST_LIMITS);
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

      {(() => {
        // Media stays hidden while the body is clipped, so a collapsed post is
        // one compact block rather than three lines of text above a full-size
        // image. Same rule as the text above it, from the same helper.
        const needsTruncation =
          truncateBodyText(normalizeBodyText(text), POST_LIMITS).needsTruncation && !isDetailed;
        const showMedia = !needsTruncation || isExpanded;
        return (
          <div className={`${styles.collapsibleMedia} ${showMedia ? styles.expanded : ''}`}>
            {postData.media && (
              <MediaGrid
                media={postData.media}
                onMediaClick={(items, index) => {
                  const meta = {
                    authorName: author.displayName,
                    authorAvatar: author.avatar,
                    authorUsername: author.username,
                    timestamp: postData.createdAt ? new Date(postData.createdAt).toLocaleString() : time,
                    source: 'Post',
                    isOwner: currentUser?.id === authorId,
                    post: postData,
                    author,
                  };
                  openViewer(items, index, meta);
                }}
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
                  <img src={getMediaUrl(postData.linkPreview.image)} alt="" loading="lazy" className={styles.linkPreviewImg} />
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
        );
      })()}

      {isDetailed && exactTimeStr && (
        <div className={styles.postExactTime}>
          {exactTimeStr}
        </div>
      )}

      <div className={styles.postActions} style={{ marginTop: '0.5rem', paddingTop: '0' }}>
        <button className={`${styles.postActionBtn} ${isLikedByMe ? styles.liked : ''}`} onClick={toggleLikeHandler}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill={isLikedByMe ? 'var(--color-primary)' : 'none'} stroke={isLikedByMe ? 'var(--color-primary)' : 'currentColor'} strokeWidth="2">
            <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
          </svg>
          <span className={styles.postActionCount}>{likes}</span>
        </button>
        <button className={styles.postActionBtn} onClick={(e) => { e.stopPropagation(); if (onClick) onClick(postData); }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
          </svg>
          <span className={styles.postActionCount}>{comments}</span>
        </button>
        <button className={styles.postActionBtn} onClick={handleShare}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
          </svg>
          <span className={styles.shareText} style={{ fontSize: '0.85rem', fontWeight: 600 }}>Share</span>
        </button>
        <button className={`${styles.postActionBtn} ${isSaved ? styles.saved : ''}`} onClick={(e) => { 
          e.stopPropagation(); 
          const entityKey = `savePost:${id}`;
          const nextSaved = toggleRegistry.getNextToggleIntent(entityKey, isSaved);
          toggleSave({ postId: id, isSaved: nextSaved, postData }); 
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill={isSaved ? 'var(--color-primary)' : 'none'} stroke={isSaved ? 'var(--color-primary)' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
          </svg>
          <span className={styles.shareText} style={{ fontSize: '0.85rem', fontWeight: 600 }}>{isSaved ? 'Saved' : 'Save'}</span>
        </button>
      </div>

      {showShareModal && (
        <SharePostModal 
          isOpen={showShareModal} 
          onClose={() => setShowShareModal(false)} 
          post={postData} 
          author={author} 
        />
      )}

      {showDeleteConfirm && (
        <div onClick={(e) => e.stopPropagation()}>
          <ConfirmModal
            title="Delete Post"
            desc="This post will be permanently removed."
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
  if (prev.poll !== next.poll && JSON.stringify(prev.poll) !== JSON.stringify(next.poll)) return false;
  if (prev.media !== next.media && JSON.stringify(prev.media) !== JSON.stringify(next.media)) return false;
  if (prev.author !== next.author && JSON.stringify(prev.author) !== JSON.stringify(next.author)) return false;
  return true;
}

export default memo(Post, arePostPropsEqual);
