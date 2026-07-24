import { useState, useEffect, memo } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { showToast } from '@shared/utils/toast';
import { isImageUrl } from '@shared/utils/avatar';
import { sanitizeUrl } from '@shared/utils/urlSanitize';
import DefaultAvatar from '@shared/components/avatar/DefaultAvatar';
import { getProcessedAvatarUrl } from '@shared/components/avatar/Avatar';
import MentionInput from '@shared/components/mentions/MentionInput';
import RichText from '@shared/components/mentions/RichText';
import { useData } from '@shared/hooks/useData';
import { postsApi } from '@shared/api/apiClient';
import usePostStore from '@shared/stores/postStore';
import { timeAgo } from '@shared/utils/time';
import styles from './Post.module.css';
import SharePostModal from '../modals/SharePostModal';
import VideoPlayer from '@shared/components/media/VideoPlayer';
import { useMediaViewer } from '@shared/context/MediaViewerContext';
import ConfirmModal from '@shared/components/modals/ConfirmModal';
import ReportModal from '@shared/components/modals/ReportModal/ReportModal';

function PollCard({ poll, postId }) {
  const { voteInPoll, currentUser } = useData();

  // Derive voted state and votes from the shared DataContext poll object
  const myVotes = poll.selectedUsers?.[currentUser?.id] || [];
  const hasVoted = myVotes.length > 0;
  const votes = poll.votes || poll.options.map(() => 0);
  const totalVotes = votes.reduce((a, b) => a + b, 0);

  // Local state only for multi-select pre-submission selection
  const [pendingSelection, setPendingSelection] = useState([]);

  const handleVote = (idx) => {
    if (hasVoted) return;

    if (poll.multiSelect) {
      setPendingSelection((prev) =>
        prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]
      );
    } else {
      voteInPoll(postId, [idx]);
    }
  };

  const confirmMultiVote = () => {
    if (pendingSelection.length === 0 || hasVoted) return;
    voteInPoll(postId, pendingSelection);
    setPendingSelection([]);
  };

  const showResults = hasVoted;
  const selected = hasVoted ? myVotes : pendingSelection;

  return (
    <div className={styles.pollCard}>
      <div className={styles.pollCardOptions}>
        {poll.options.map((opt, i) => {
          const pct = showResults && totalVotes > 0 ? Math.round((votes[i] / totalVotes) * 100) : 0;
          const isSelected = selected.includes(i);

          return (
            <button
              key={i}
              className={`${styles.pollCardOption}${isSelected ? ` ${styles.selected}` : ''}${showResults ? ` ${styles.voted}` : ''}`}
              onClick={() => handleVote(i)}
              disabled={showResults}
            >
              <div className={styles.pollOptionFill} style={{ width: showResults ? `${pct}%` : '0%' }} />
              <span className={styles.pollOptionLabel}>
                {poll.multiSelect && !showResults && (
                  <span className={`${styles.pollCheckbox}${isSelected ? ` ${styles.checked}` : ''}`}>
                    {isSelected && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5"><polyline points="20 6 9 17 4 12" /></svg>}
                  </span>
                )}
                {opt}
              </span>
              {showResults && <span className={styles.pollOptionPct}>{pct}%</span>}
            </button>
          );
        })}
      </div>
      <div className={styles.pollCardFooter}>
        {poll.multiSelect && <span className={styles.pollMultiBadge}>Multi</span>}
        {poll.multiSelect && !hasVoted && pendingSelection.length > 0 && (
          <button className={styles.pollConfirmBtn} onClick={confirmMultiVote}>Confirm</button>
        )}
        <span className={styles.pollVoteCount}>{totalVotes} {totalVotes === 1 ? 'vote' : 'votes'}</span>
      </div>
    </div>
  );
}

const normalizePostText = (str) => {
  if (!str) return '';
  return str
    .trim()
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
};

function Post({ postData, communityTag, onClick, isDetailed = false, hideCommunityTag = false }) {
  const { getUserById, getPostById, communities, currentUser, savedPosts = [], toggleSavePost } = useData();
  const queryClient = useQueryClient();
  const { openViewer } = useMediaViewer();
  const [showMenu, setShowMenu] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [hasReported, setHasReported] = useState(false);

  const livePost = postData ? (getPostById(postData.id) || postData) : null;
  if (!livePost) return null;

  const { id, authorId, time, text, mentions, poll, likeCount, commentCount, hasLiked, isLiked, isLikedByMe: rawIsLiked } = livePost;
  
  const initialLiked = hasLiked !== undefined ? !!hasLiked : (isLiked !== undefined ? !!isLiked : (rawIsLiked !== undefined ? !!rawIsLiked : (livePost.likedBy ? livePost.likedBy.includes(currentUser?.id) : false)));
  const initialLikes = likeCount !== undefined ? likeCount : (livePost.likesCount !== undefined ? livePost.likesCount : (livePost.likes || 0));

  const [localLiked, setLocalLiked] = useState(initialLiked);
  const [localLikesCount, setLocalLikesCount] = useState(initialLikes);

  useEffect(() => {
    setLocalLiked(initialLiked);
    setLocalLikesCount(initialLikes);
  }, [initialLiked, initialLikes]);

  const isLikedByMe = localLiked;
  const likes = localLikesCount;
  const comments = commentCount !== undefined ? commentCount : (livePost.commentsCount !== undefined ? livePost.commentsCount : (livePost.comments || 0));
  const isSaved = savedPosts.includes(id);
  const author = livePost.author || getUserById(authorId) || { displayName: 'User', username: 'user', avatar: null };
  const authorCollege = author.collegeId ? communities[author.collegeId] : null;

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

  const formatExactDate = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return `${timeStr} · ${dateStr}`;
  };

  const exactTimeStr = livePost.createdAt ? formatExactDate(livePost.createdAt) : time;

  const handleCardClick = (e) => {
    if (isDetailed) return;
    if (onClick) onClick(e);
  };

  const syncCacheForPost = (targetPostId, newLiked, newLikesCount) => {
    const updatePostObject = (p) => {
      if (!p || p.id !== targetPostId) return p;
      return {
        ...p,
        hasLiked: newLiked,
        isLiked: newLiked,
        isLikedByMe: newLiked,
        likeCount: newLikesCount,
        likesCount: newLikesCount,
      };
    };

    queryClient.setQueriesData({}, (oldData) => {
      if (!oldData) return oldData;
      if (oldData.id === targetPostId) {
        return updatePostObject(oldData);
      }
      if (Array.isArray(oldData.pages)) {
        return {
          ...oldData,
          pages: oldData.pages.map((page) => {
            if (!page) return page;
            const key = Array.isArray(page.posts) ? 'posts' : (Array.isArray(page.items) ? 'items' : null);
            if (!key) return page;
            return { ...page, [key]: page[key].map(updatePostObject) };
          }),
        };
      }
      if (Array.isArray(oldData)) {
        return oldData.map(updatePostObject);
      }
      return oldData;
    });
  };

  const toggleLike = (e) => {
    e.stopPropagation();
    const prevLiked = isLikedByMe;
    const prevLikes = likes;
    const nextLiked = !prevLiked;
    const nextLikes = nextLiked ? prevLikes + 1 : Math.max(0, prevLikes - 1);

    // 1. Optimistic local state update
    setLocalLiked(nextLiked);
    setLocalLikesCount(nextLikes);

    // 2. Optimistic React Query cache update across all active feeds
    syncCacheForPost(id, nextLiked, nextLikes);

    // 3. Perform backend mutation
    const apiCall = nextLiked ? postsApi.likePost(id) : postsApi.unlikePost(id);
    apiCall
      .then((res) => {
        const finalLiked = res?.isLiked !== undefined ? res.isLiked : nextLiked;
        const finalLikes = res?.likeCount !== undefined ? res.likeCount : nextLikes;
        setLocalLiked(finalLiked);
        setLocalLikesCount(finalLikes);
        syncCacheForPost(id, finalLiked, finalLikes);

        queryClient.invalidateQueries({ queryKey: ['feed'] });
        queryClient.invalidateQueries({ queryKey: ['posts'] });
        queryClient.invalidateQueries({ queryKey: ['user-posts'] });
        queryClient.invalidateQueries({ queryKey: ['bookmarks'] });
        queryClient.invalidateQueries({ queryKey: ['post', id] });
      })
      .catch((err) => {
        console.error('Failed to toggle like:', err);
        setLocalLiked(prevLiked);
        setLocalLikesCount(prevLikes);
        syncCacheForPost(id, prevLiked, prevLikes);
        showToast('Failed to update like');
      });
  };

  const handleShare = (e) => {
    e.stopPropagation();
    e.preventDefault();
    setShowShareModal(true);
  };

  const postCommunity = (!hideCommunityTag && livePost.communityId) ? communities[livePost.communityId] : null;

  return (
    <div className={styles.post} onClick={handleCardClick} style={{ cursor: (!isDetailed && onClick) ? 'pointer' : 'default' }}>
      <div className={styles.postHeader}>
        <div className={styles.postAvatarContainer}>
          <Link to={`/profile/${author.username}`} style={{ textDecoration: 'none' }} onClick={(e) => e.stopPropagation()}>
            <div className={styles.postAvatar}>
              {isImageUrl(author.avatar) ? (
                <img src={getProcessedAvatarUrl(author.avatar)} alt={author.displayName} loading="lazy" className={styles.postAvatarImg}  onError={(e) => { e.target.onerror = null; e.target.src = '/default_avatar.png'; }} />
              ) : (
                <DefaultAvatar />
              )}
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
                <img src={postCommunity.avatar} alt="" loading="lazy"  onError={(e) => { e.target.onerror = null; e.target.src = '/default_avatar.png'; }} />
              ) : (
                <span>{postCommunity.avatar || postCommunity.name?.charAt(0).toUpperCase()}</span>
              )}
            </Link>
          )}
        </div>
        <div className={styles.postUser}>
          <Link to={`/profile/${author.username}`} style={{ textDecoration: 'none', color: 'inherit', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }} onClick={(e) => e.stopPropagation()}>
            <div className={`hover-underline ${styles.postName}`}>{author.displayName}</div>

            {authorCollege && (
              <img
                src={authorCollege.avatar}
                alt={authorCollege.name}
                loading="lazy"
                className={styles.postCollegeIcon}
                title={authorCollege.name}
               onError={(e) => { e.target.onerror = null; e.target.src = '/default_avatar.png'; }} />
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
            <span>{livePost.createdAt ? timeAgo(livePost.createdAt) : (time ? timeAgo(time) : '')}</span>
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
              {currentUser && authorId === currentUser.id && (
                <>
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
                </>
              )}
              {/* Report — for all posts */}
              {(!currentUser || authorId !== currentUser.id) && (
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
        const normalizedText = normalizePostText(text);
        const lines = normalizedText.split('\n');
        const lineCount = lines.length;
        const textLength = normalizedText.length;
        
        const exceedsCharLimit = textLength > 300;
        const exceedsLineLimit = lineCount > 8;
        const needsTruncation = (exceedsCharLimit || exceedsLineLimit) && !isDetailed;

        let displayedText = normalizedText;
        if (needsTruncation && !isExpanded) {
          let tempText = normalizedText;
          if (exceedsCharLimit) {
            tempText = normalizedText.slice(0, 300);
          }
          const tempLines = tempText.split('\n');
          if (tempLines.length > 8) {
            displayedText = tempLines.slice(0, 8).join('\n');
          } else {
            displayedText = tempText;
          }
          if (displayedText.length < normalizedText.length) {
            displayedText = displayedText.trimEnd() + '...';
          }
        }

        const displayedMentions = (needsTruncation && !isExpanded)
          ? (mentions || []).filter(m => m.end <= (displayedText.endsWith('...') ? displayedText.length - 3 : displayedText.length))
          : mentions;

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
        const normalizedText = normalizePostText(text);
        const lines = normalizedText.split('\n');
        const lineCount = lines.length;
        const textLength = normalizedText.length;
        const needsTruncation = (textLength > 300 || lineCount > 8) && !isDetailed;
        const showMedia = !needsTruncation || isExpanded;
        return (
          <div className={`${styles.collapsibleMedia} ${showMedia ? styles.expanded : ''}`}>
            {livePost.media && (() => {
              let mediaSrc = null;
              let isVideo = false;

              if (Array.isArray(livePost.media)) {
                if (livePost.media.length > 0) {
                  mediaSrc = livePost.media[0].storageKey || livePost.media[0].url;
                  isVideo = livePost.media[0].type === 'VIDEO' || (mediaSrc && (mediaSrc.endsWith('.mp4') || mediaSrc.startsWith('data:video')));
                }
              } else if (typeof livePost.media === 'string') {
                mediaSrc = livePost.media;
                isVideo = mediaSrc.endsWith('.mp4') || mediaSrc.startsWith('data:video');
              } else if (livePost.media?.url) {
                mediaSrc = livePost.media.url;
                isVideo = livePost.media.type === 'video' || (mediaSrc && (mediaSrc.endsWith('.mp4') || mediaSrc.startsWith('data:video')));
              }

              if (!mediaSrc) return null;
              
              const openMedia = (e) => {
                e.stopPropagation();
                const meta = {
                  authorName: author.displayName,
                  authorAvatar: author.avatar,
                  authorUsername: author.username,
                  timestamp: livePost.createdAt ? new Date(livePost.createdAt).toLocaleString() : time,
                  source: 'Post',
                  isOwner: currentUser?.id === authorId,
                  post: livePost,
                  author,
                };
                openViewer(
                  [{ url: mediaSrc, type: isVideo ? 'video' : 'image', caption: livePost.text || '' }],
                  0,
                  meta,
                );
              };
              return (
                <div className={styles.postMedia} onClick={(e) => e.stopPropagation()}>
                  {isVideo ? (
                    <VideoPlayer src={mediaSrc} />
                  ) : (
                    <img
                      src={mediaSrc}
                      alt="Post attachment"
                      loading="lazy"
                      className={styles.mediaItem}
                      onClick={openMedia}
                      style={{ cursor: 'zoom-in' }}
                    />
                  )}
                </div>
              );
            })()}
            {livePost.linkPreview && (
              <a
                href={sanitizeUrl(livePost.linkPreview.url)}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.linkPreview}
                onClick={(e) => e.stopPropagation()}
              >
                {livePost.linkPreview.image && (
                  <img src={livePost.linkPreview.image} alt="" loading="lazy" className={styles.linkPreviewImg} />
                )}
                <div className={styles.linkPreviewBody}>
                  {livePost.linkPreview.site && (
                    <span className={styles.linkPreviewSite}>{livePost.linkPreview.site}</span>
                  )}
                  <span className={styles.linkPreviewTitle}>{livePost.linkPreview.title}</span>
                  {livePost.linkPreview.description && (
                    <span className={styles.linkPreviewDesc}>{livePost.linkPreview.description}</span>
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
        <button className={`${styles.postActionBtn} ${isLikedByMe ? styles.liked : ''}`} onClick={toggleLike}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill={isLikedByMe ? 'var(--color-primary)' : 'none'} stroke={isLikedByMe ? 'var(--color-primary)' : 'currentColor'} strokeWidth="2">
            <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
          </svg>
          <span className={styles.postActionCount}>{likes}</span>
        </button>
        <button className={styles.postActionBtn} onClick={(e) => { e.stopPropagation(); if(onClick) onClick(); }}>
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
        <button className={`${styles.postActionBtn} ${isSaved ? styles.saved : ''}`} onClick={(e) => { e.stopPropagation(); toggleSavePost(id); }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill={isSaved ? 'var(--color-primary)' : 'none'} stroke={isSaved ? 'var(--color-primary)' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
          </svg>
          <span className={styles.shareText} style={{ fontSize: '0.85rem', fontWeight: 600 }}>{isSaved ? 'Saved' : 'Save'}</span>
        </button>
      </div>
      <SharePostModal 
        isOpen={showShareModal} 
        onClose={() => setShowShareModal(false)} 
        post={livePost} 
        author={author} 
      />
      <div onClick={(e) => e.stopPropagation()}>
        <ConfirmModal
          title="Delete Post?"
          desc="Are you sure you want to delete this post? This action is permanent and cannot be undone."
          visible={showDeleteConfirm}
          onCancel={() => setShowDeleteConfirm(false)}
          onConfirm={async () => {
            setShowDeleteConfirm(false);
            try {
              await postsApi.deletePost(id);
              queryClient.invalidateQueries(['feed']);
              showToast('Post deleted');
            } catch (err) {
              showToast('Failed to delete post');
            }
          }}
          confirmText="Delete"
        />
      </div>

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
    </div>
  );
}

export default memo(Post);
