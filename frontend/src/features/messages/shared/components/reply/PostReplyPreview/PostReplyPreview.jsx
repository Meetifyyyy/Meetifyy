import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Avatar from '@shared/components/avatar/Avatar';
import { Play, Copy, BarChart2, FileX } from '@shared/components/icons';
import { usePostLookup } from '@shared/hooks/usePostLookup';
import { postsApi, getMediaUrl } from '@shared/api/apiClient';
import styles from './PostReplyPreview.module.css';

/**
 * Checks whether a quoted message is a post reply.
 * Accepts full message object, optimistic payload, or server `replyTo` snapshot.
 */
export function isPostReply(replyTo) {
  if (!replyTo || typeof replyTo !== 'object') return false;
  if (replyTo.shareType === 'post') return true;
  if (replyTo.post || replyTo.payload?.post || replyTo.payload?.inviteData?.post || replyTo.inviteData?.post) return true;
  if (replyTo.inviteData?.type === 'postShare' || replyTo.payload?.inviteData?.type === 'postShare') return true;
  return false;
}

/**
 * Compact chat post preview card shown ABOVE the actual reply message.
 *
 * @param {{
 *   replyTo: object,
 *   isMe?: boolean,
 *   currentUser?: object|null,
 *   onJumpToMessage?: (id: string) => void,
 * }} props
 */
export function PostReplyPreview({
  replyTo,
  isMe = false,
  currentUser = null,
  onJumpToMessage,
}) {
  const navigate = useNavigate();
  const getPostById = usePostLookup();
  const [mediaError, setMediaError] = useState(false);
  const [naturalAspects, setNaturalAspects] = useState({});

  const handleImageLoad = (url, e) => {
    if (e?.target?.naturalWidth && e?.target?.naturalHeight) {
      const ratio = e.target.naturalWidth / e.target.naturalHeight;
      if (ratio && !isNaN(ratio)) {
        setNaturalAspects((prev) => ({
          ...prev,
          [url]: Math.min(Math.max(ratio, 0.65), 2.2),
        }));
      }
    }
  };

  // Extract direct post data if attached in optimistic state or live message
  const directPost =
    replyTo?.payload?.post ||
    replyTo?.payload?.inviteData?.post ||
    replyTo?.inviteData?.post ||
    replyTo?.post ||
    null;

  const postId =
    directPost?.id ||
    replyTo?.shareId ||
    (replyTo?.shareType === 'post' ? replyTo.shareId : null) ||
    null;

  // Check React Query cache
  const cachedPost = postId ? getPostById(postId) : null;

  // If not cached and missing full details, fetch from API
  const shouldFetch = Boolean(
    replyTo &&
    postId &&
    !directPost?.author &&
    !cachedPost?.author &&
    !replyTo?.isUnsent
  );

  const { data: fetchedPost, isError } = useQuery({
    queryKey: ['post', postId],
    queryFn: () => postsApi.getPostById(postId),
    enabled: shouldFetch,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  if (!replyTo) return null;

  const post = fetchedPost || cachedPost || directPost;

  // Check for deleted or unavailable states
  const isUnavailable =
    replyTo.isUnsent === true ||
    post?.deleted === true ||
    (isError && !directPost && !replyTo.shareTitle);

  const handleJumpToOriginal = (e) => {
    e.stopPropagation();
    if (onJumpToMessage && replyTo.id) {
      onJumpToMessage(replyTo.id);
    }
  };

  const handleCardClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (postId && !isUnavailable) {
      navigate(`/post/${postId}`, { state: { from: 'chat' } });
    } else if (onJumpToMessage && replyTo.id) {
      onJumpToMessage(replyTo.id);
    }
  };

  // Author information
  const author = post?.author || null;
  const authorName =
    author?.displayName ||
    author?.username ||
    post?.authorName ||
    (replyTo.shareType === 'post' ? replyTo.senderName : null) ||
    'Someone';
  const authorUsername = author?.username || post?.authorUsername || post?.username || null;
  const authorAvatar = author?.avatar || post?.authorAvatar || replyTo.shareAvatar || null;

  // Resolve media items
  const resolveMediaList = () => {
    let list = [];
    const rawMedia = (Array.isArray(post?.media) && post.media.length > 0) ? post.media : null;
    if (rawMedia) {
      list = rawMedia.map((m) => {
        if (typeof m === 'string') return { url: getMediaUrl(m), type: 'image' };
        const rawUrl = m.url || (m.objectKey ? `/api/media/${m.objectKey}` : null) || (m.storageKey ? `/api/media/${m.storageKey}` : null) || (m.path ? `/api/media/${m.path}` : null);
        return {
          url: getMediaUrl(rawUrl),
          type: m.type || (rawUrl && /\.(mp4|webm|mov)$/i.test(rawUrl) ? 'video' : 'image'),
          aspectRatio: m.aspectRatio || (m.width && m.height ? m.width / m.height : undefined),
          width: m.width,
          height: m.height,
        };
      }).filter((m) => m.url);
    } else if (Array.isArray(post?.images) && post.images.length > 0) {
      list = post.images.map((img) => ({
        url: getMediaUrl(typeof img === 'string' ? img : (img.url || (img.objectKey ? `/api/media/${img.objectKey}` : null) || (img.storageKey ? `/api/media/${img.storageKey}` : null))),
        type: 'image',
        aspectRatio: typeof img === 'object' ? (img.aspectRatio || (img.width && img.height ? img.width / img.height : undefined)) : undefined,
        width: typeof img === 'object' ? img.width : undefined,
        height: typeof img === 'object' ? img.height : undefined,
      })).filter((m) => m.url);
    } else {
      const singleUrl = post?.image || post?.mediaUrl || post?.mediaKey || (typeof rawMedia === 'string' ? rawMedia : null);
      if (singleUrl) {
        const rawUrl = typeof singleUrl === 'string' ? singleUrl : (singleUrl.url || (singleUrl.objectKey ? `/api/media/${singleUrl.objectKey}` : null) || (singleUrl.storageKey ? `/api/media/${singleUrl.storageKey}` : null));
        if (rawUrl) {
          list = [{
            url: getMediaUrl(rawUrl),
            type: post?.mediaType || (/\.(mp4|webm|mov)$/i.test(rawUrl) ? 'video' : 'image'),
            aspectRatio: post?.aspectRatio || (post?.width && post?.height ? post.width / post.height : undefined),
            width: post?.width,
            height: post?.height,
          }];
        }
      }
    }
    return list;
  };

  const mediaList = resolveMediaList();
  const primaryMedia = mediaList.length > 0 ? mediaList[0] : null;
  const hasMedia = Boolean(primaryMedia && !mediaError);
  const isVideo = primaryMedia?.type === 'video';
  const isMultiple = mediaList.length > 1;

  // Dynamic aspect ratio calculation
  const getSingleMediaAspect = (item) => {
    if (!item) return null;
    if (item.url && naturalAspects[item.url]) {
      return naturalAspects[item.url];
    }
    if (item.aspectRatio && typeof item.aspectRatio === 'number' && !isNaN(item.aspectRatio)) {
      return Math.min(Math.max(item.aspectRatio, 0.65), 2.2);
    }
    if (item.width && item.height && item.width > 0 && item.height > 0) {
      const calculated = item.width / item.height;
      return Math.min(Math.max(calculated, 0.65), 2.2);
    }
    return null;
  };
  const singleAspect = getSingleMediaAspect(primaryMedia);

  // Poll resolution
  const pollData = post?.poll || (Array.isArray(post?.pollOptions) && post.pollOptions.length > 0 ? {
    question: post?.pollQuestion || post?.text || 'Poll',
    options: post.pollOptions.map((opt) => ({
      id: typeof opt === 'object' ? opt?.id : undefined,
      text: typeof opt === 'object' ? (opt?.text || opt?.label || opt?.title || '') : String(opt || ''),
      votes: typeof opt === 'object' ? (Number(opt?.voteCount ?? opt?.votes ?? opt?._count?.votes) || 0) : 0,
    })),
  } : null);

  const hasPoll = Boolean(pollData);
  const totalPollVotes = pollData?.options?.reduce((sum, o) => sum + (o.votes || 0), 0) || 0;

  // Post text content: only suppress duplicate text when poll widget is visible (!hasMedia)
  const rawPostText = post?.text || replyTo.shareTitle || '';
  const isDuplicatePollQuestion = Boolean(
    !hasMedia &&
    pollData &&
    rawPostText.trim().toLowerCase() === (typeof pollData.question === 'string' ? pollData.question.trim().toLowerCase() : '')
  );
  const postText = isDuplicatePollQuestion ? '' : rawPostText;

  // Resolve current user ID and username with localStorage fallback if unhydrated
  let myId = currentUser?.id || currentUser?._id || currentUser?.userId || null;
  let myUsername = currentUser?.username || null;
  if ((!myId || !myUsername) && typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem('user') || localStorage.getItem('auth_user') || localStorage.getItem('currentUser');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (!myId) myId = parsed?.id || parsed?._id || parsed?.userId || null;
        if (!myUsername) myUsername = parsed?.username || null;
      }
    } catch {}
  }

  // Check if replying to oneself (either own message in chat or own post)
  const isRepliedToMyMessage =
    replyTo.from === 'me' ||
    replyTo.senderId === 'me' ||
    (myId && replyTo.senderId && String(replyTo.senderId) === String(myId)) ||
    (myUsername && replyTo.senderUsername && replyTo.senderUsername.toLowerCase() === myUsername.toLowerCase());

  const isRepliedToMyPost =
    (myUsername && authorUsername && authorUsername.toLowerCase() === myUsername.toLowerCase()) ||
    (myId && author?.id && String(author.id) === String(myId)) ||
    (myId && (post?.authorId || directPost?.authorId) && String(post?.authorId || directPost?.authorId) === String(myId));

  const isSelf = isRepliedToMyMessage || isRepliedToMyPost;

  let contextText = '';
  if (isMe) {
    contextText = isSelf ? 'You replied to yourself' : `You replied to ${authorName}`;
  } else {
    const sender = replyTo.senderName || 'Sender';
    if (isRepliedToMyPost || isRepliedToMyMessage) {
      contextText = `${sender} replied to your post`;
    } else if (
      (authorUsername && replyTo.senderUsername && authorUsername.toLowerCase() === replyTo.senderUsername.toLowerCase()) ||
      (author?.id && replyTo.senderId && String(author.id) === String(replyTo.senderId))
    ) {
      contextText = `${sender} replied to their post`;
    } else {
      contextText = `${sender} replied to ${authorName}'s post`;
    }
  }

  return (
    <div
      className={`${styles.replyContainer} ${isMe ? styles.replyContainerMe : styles.replyContainerThem}`}
      aria-label="Referenced post preview"
    >
      {/* Context Label */}
      <div
        className={`${styles.contextLabel} ${onJumpToMessage && replyTo.id ? styles.contextLabelClickable : ''}`}
        onClick={handleJumpToOriginal}
        role={onJumpToMessage && replyTo.id ? 'button' : undefined}
        tabIndex={onJumpToMessage && replyTo.id ? 0 : undefined}
        title={onJumpToMessage && replyTo.id ? 'Jump to referenced message' : undefined}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && onJumpToMessage && replyTo.id) {
            e.preventDefault();
            onJumpToMessage(replyTo.id);
          }
        }}
      >
        {contextText}
      </div>

      {/* Unavailable State */}
      {isUnavailable ? (
        <div
          className={styles.unavailableCard}
          role="status"
          onClick={handleJumpToOriginal}
          style={{ cursor: onJumpToMessage && replyTo.id ? 'pointer' : 'default' }}
        >
          <FileX size={15} className={styles.unavailableIcon} aria-hidden="true" />
          <span>Post unavailable</span>
        </div>
      ) : (
        /* Compact Post Card */
        <div
          className={styles.postCard}
          onClick={handleCardClick}
          role="link"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              handleCardClick(e);
            }
          }}
        >
          {/* Author Row */}
          <div className={styles.authorRow}>
            <Avatar src={authorAvatar} name={authorName} size="28px" disableHover />
            <div className={styles.authorMeta}>
              <span className={styles.authorName}>{authorName}</span>
              {authorUsername && (
                <span className={styles.authorUsername}>@{authorUsername.replace(/^@/, '')}</span>
              )}
            </div>
            {hasPoll && (
              <div className={styles.pollBadgeTop} title="Poll" aria-label="Poll">
                <BarChart2 size={13} className={styles.pollBadgeIcon} />
              </div>
            )}
          </div>

          {/* Post Text Content */}
          {postText && (
            <div className={styles.threeLineContent} title={postText}>
              {postText}
            </div>
          )}

          {/* Media Thumbnail */}
          {hasMedia && (
            <div
              className={styles.mediaArea}
              style={singleAspect ? { aspectRatio: singleAspect } : undefined}
              data-aspect-ratio={singleAspect || undefined}
            >
              <img
                src={primaryMedia.url}
                alt="Post thumbnail"
                className={styles.thumbnailImg}
                loading="lazy"
                onLoad={(e) => handleImageLoad(primaryMedia.url, e)}
                onError={() => setMediaError(true)}
              />
              {isVideo && (
                <div className={styles.videoPlayOverlay} aria-label="Video">
                  <Play size={15} fill="currentColor" />
                </div>
              )}
              {isMultiple && (
                <div className={styles.carouselBadge} aria-label="Multiple photos">
                  <Copy size={11} />
                  <span>{mediaList.length}</span>
                </div>
              )}
            </div>
          )}

          {/* Poll section: only render options preview when post has no media */}
          {pollData && !hasMedia && (
            <div className={styles.pollPreviewWidget}>
              <div className={styles.pollHeader}>
                <BarChart2 size={12} className={styles.pollIcon} />
                <span className={styles.pollQuestion}>
                  {typeof pollData.question === 'string' ? pollData.question : 'Poll'}
                </span>
              </div>
              <div className={styles.pollOptionsList}>
                {pollData.options?.slice(0, 2).map((opt, idx) => {
                  const pct = totalPollVotes > 0 ? Math.round(((opt.votes || 0) / totalPollVotes) * 100) : 0;
                  return (
                    <div key={opt.id || idx} className={styles.pollOptionItem}>
                      {totalPollVotes > 0 && (
                        <div className={styles.pollOptionFill} style={{ width: `${pct}%` }} />
                      )}
                      <span className={styles.pollOptionText}>{opt.text}</span>
                      {totalPollVotes > 0 && (
                        <span className={styles.pollOptionPct}>{pct}%</span>
                      )}
                    </div>
                  );
                })}
              </div>
              {pollData.options?.length > 2 && (
                <span className={styles.pollMeta}>
                  +{pollData.options.length - 2} more {pollData.options.length - 2 === 1 ? 'option' : 'options'}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default PostReplyPreview;
