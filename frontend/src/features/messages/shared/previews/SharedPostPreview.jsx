import { useNavigate } from 'react-router-dom';
import Avatar from '@shared/components/avatar/Avatar';
import PostPreviewSkeleton from '@shared/components/skeletons/PostPreviewSkeleton';
import { Image as ImageIcon, Heart, MessageCircle, FileX } from 'lucide-react';
import styles from './SharedPostPreview.module.css';
import { useData } from '@shared/hooks/useData';

export function SharedPostPreview({ post, isLoading = false }) {
  const navigate = useNavigate();
  const { getPostById, getUserById } = useData();

  if (isLoading) {
    return <PostPreviewSkeleton />;
  }

  const livePost = post ? getPostById(post.id) : null;
  const isPostUnavailable = !post || (livePost && livePost.deleted);

  if (isPostUnavailable) {
    return (
      <div className={styles.unavailable} role="alert">
        <FileX size={14} />
        <span>This post is no longer available</span>
      </div>
    );
  }

  const authorId = livePost?.authorId;
  const liveAuthor = authorId ? getUserById(authorId) : null;
  
  const authorName = liveAuthor?.displayName || liveAuthor?.username || post.authorName || 'Someone';
  const authorAvatar = liveAuthor?.avatar || post.authorAvatar;
  const contentText = livePost?.text || post.text || '';

  let mediaUrl = null;
  if (livePost?.media) {
    mediaUrl = typeof livePost.media === 'string' ? livePost.media : (livePost.media.url || livePost.media.objectKey);
  } else if (post.image) {
    mediaUrl = post.image;
  }

  const hasMedia = Boolean(mediaUrl);

  const likesCount = Array.isArray(livePost?.likedBy) 
    ? livePost.likedBy.length 
    : (typeof livePost?.likes === 'number' ? livePost.likes : (post.likes || 0));

  const commentsCount = Array.isArray(livePost?.comments) 
    ? livePost.comments.length 
    : (typeof livePost?.comments === 'number' ? livePost.comments : (post.comments || 0));

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
      aria-label={`Post by ${authorName}`}
    >
      <div className={styles.authorRow}>
        <Avatar src={authorAvatar} name={authorName} size="22px" />
        <span className={styles.authorName}>{authorName}</span>
        <span className={styles.timestamp}>• {post.time || 'Recent'}</span>
      </div>

      {contentText && (
        <div className={styles.singleLineContent} title={contentText}>
          {contentText}
        </div>
      )}

      {hasMedia && (
        <div className={styles.attachmentPill}>
          <ImageIcon size={13} />
          <span>Attachment</span>
        </div>
      )}

      <div className={styles.metaRow}>
        <span className={styles.statItem}>
          <Heart size={13} />
          {likesCount}
        </span>
        <span className={styles.statItem}>
          <MessageCircle size={13} />
          {commentsCount}
        </span>
      </div>
    </div>
  );
}
