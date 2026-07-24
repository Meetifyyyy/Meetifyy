import { useNavigate } from 'react-router-dom';

import { isImageUrl } from '@shared/utils/avatar';
import DefaultAvatar from '@shared/components/avatar/DefaultAvatar';
import PostPreviewSkeleton from '@shared/components/skeletons/PostPreviewSkeleton';
import { Link2, Heart, MessageCircle, FileX } from 'lucide-react';
import styles from './SharedPostPreview.module.css';
import { useData } from '@shared/hooks/useData';


export function SharedPostPreview({ post, isLoading = false }) {
  const navigate = useNavigate();
  const { getPostById, getUserById, communities } = useData();

  if (isLoading) {
    return <PostPreviewSkeleton />;
  }

  // Get live post from context if it exists
  const livePost = post ? getPostById(post.id) : null;
  const isPostUnavailable = !post || (livePost && livePost.deleted);

  if (isPostUnavailable) {
    return (
      <div className={styles.unavailable} role="alert">
        <FileX size={16} />
        <span>This post is no longer available</span>
      </div>
    );
  }

  // Resolve author
  const authorId = livePost?.authorId;
  const liveAuthor = authorId ? getUserById(authorId) : null;
  
  const authorName = liveAuthor?.displayName || post.authorName || 'Someone';
  const authorAvatar = liveAuthor?.avatar || post.authorAvatar;
  const authorUsername = liveAuthor?.username;

  // Resolve content
  const contentText = livePost?.text || post.text || '';
  const isTruncated = contentText.length > 140; // Approx 3 lines limit for fade-out

  // Resolve media (image or video)
  let mediaUrl = null;
  if (livePost?.media) {
    mediaUrl = typeof livePost.media === 'string' ? livePost.media : livePost.media.url;
  } else if (post.image) {
    mediaUrl = post.image;
  }

  // Resolve likes and comments
  const likesCount = Array.isArray(livePost?.likedBy) 
    ? livePost.likedBy.length 
    : (typeof livePost?.likes === 'number' ? livePost.likes : (post.likes || 0));

  const commentsCount = Array.isArray(livePost?.comments) 
    ? livePost.comments.length 
    : (typeof livePost?.comments === 'number' ? livePost.comments : (post.comments || 0));

  // Resolve community tag
  const communityId = livePost?.communityId || post.communityId;
  const community = communityId ? communities[communityId] : null;
  const communityName = community?.name || post.community;

  // Resolve poll indicator
  const isPoll = !!(livePost?.poll || post.pollQuestion);

  const handleCardClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    navigate(`/post/${post.id}`, { state: { from: 'chat' } });
  };

  return (
    <div 
      className={styles.container} 
      onClick={handleCardClick}
      role="article"
      aria-label={`Shared post by ${authorName}`}
    >
      <div className={styles.headerStrip}>
        <span className={styles.headerTitle}>
          <Link2 size={12} />
          {isPoll ? 'Shared Poll' : 'Shared Post'}
        </span>
      </div>

      <div className={styles.cardBody}>
        {/* Author Info */}
        <div className={styles.authorRow}>
          {isImageUrl(authorAvatar) ? (
            <img src={authorAvatar} alt={authorName} className={styles.avatar}  onError={(e) => { e.target.onerror = null; e.target.src = '/default_avatar.png'; }} />
          ) : (
            <DefaultAvatar name={authorName} size={24} className={styles.avatar} />
          )}
          <span className={styles.authorName}>{authorName}</span>
          <span className={styles.timestamp}>• {post.time || 'Recent'}</span>
        </div>

        {/* Text Content */}
        {contentText && (
          <div className={`${styles.contentContainer} ${isTruncated ? styles.contentContainerTruncated : ''}`}>
            <p className={styles.textContent}>
              {contentText}
            </p>
          </div>
        )}

        {/* Optional Media (16:9 Aspect Ratio) */}
        {mediaUrl && (
          <div className={styles.mediaWrapper}>
            <img src={mediaUrl} alt="Post attachment" className={styles.mediaImg} />
          </div>
        )}
      </div>

      {/* Meta/Stats Row */}
      <div className={styles.metaRow}>
        <div className={styles.stats}>
          <span className={styles.statItem}>
            <Heart size={14} />
            {likesCount}
          </span>
          <span className={styles.statItem}>
            <MessageCircle size={14} />
            {commentsCount}
          </span>
        </div>
        {communityName && (
          <span className={styles.communityBadge}>
            {communityName}
          </span>
        )}
      </div>
    </div>
  );
}
