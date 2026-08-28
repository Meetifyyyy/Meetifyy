import { useState, memo } from 'react';
import { useAuth } from '@shared/context/AuthContext';
import { useLikePost } from '../../hooks/useLikePost';
import { useSavePost } from '../../hooks/useSavePost';
import { toggleRegistry } from '@shared/utils/mutationRegistry';
import { Bookmark } from '@shared/components/icons';
import SharePostModal from '../modals/SharePostModal';
import styles from './Post.module.css';

function PostActions({
  post,
  onCommentClick,
  className = '',
  style,
  authorOverride,
}) {
  const { currentUser } = useAuth();
  const { mutate: toggleLike } = useLikePost();
  const { mutate: toggleSave } = useSavePost();
  const [showShareModal, setShowShareModal] = useState(false);

  if (!post || !post.id) return null;

  const id = post.id;
  const author = authorOverride || post.author || { id: post.authorId, displayName: 'User', username: 'user', avatar: null };

  const rawIsLikedByMe = post.hasLiked !== undefined
    ? !!post.hasLiked
    : (post.isLiked !== undefined
      ? !!post.isLiked
      : (post.isLikedByMe !== undefined
        ? !!post.isLikedByMe
        : (post.likedBy ? post.likedBy.includes(currentUser?.id) : false)));
  const isLikedByMe = toggleRegistry.getLatestIntent(`likePost:${id}`, rawIsLikedByMe);

  const likes = post.likeCount !== undefined
    ? post.likeCount
    : (post.likesCount !== undefined
      ? post.likesCount
      : (post.likes || 0));

  const comments = post.commentCount !== undefined
    ? post.commentCount
    : (post.commentsCount !== undefined
      ? post.commentsCount
      : (post.comments || 0));

  const rawIsSaved = post.hasBookmarked !== undefined
    ? !!post.hasBookmarked
    : (post.isBookmarked !== undefined
      ? !!post.isBookmarked
      : false);
  const isSaved = toggleRegistry.getLatestIntent(`savePost:${id}`, rawIsSaved);

  const toggleLikeHandler = (e) => {
    e.stopPropagation();
    const entityKey = `likePost:${id}`;
    const nextLiked = toggleRegistry.getNextToggleIntent(entityKey, isLikedByMe);
    toggleLike({ postId: id, isLiked: nextLiked });
  };

  const handleCommentHandler = (e) => {
    e.stopPropagation();
    if (onCommentClick) {
      onCommentClick(e, post);
    }
  };

  const handleShare = (e) => {
    e.stopPropagation();
    e.preventDefault();
    setShowShareModal(true);
  };

  const toggleSaveHandler = (e) => {
    e.stopPropagation();
    const entityKey = `savePost:${id}`;
    const nextSaved = toggleRegistry.getNextToggleIntent(entityKey, isSaved);
    toggleSave({ postId: id, isSaved: nextSaved, postData: post });
  };

  return (
    <>
      <div className={`${styles.postActions} ${className}`} style={{ marginTop: '0.5rem', paddingTop: '0', ...style }}>
        <button
          type="button"
          className={`${styles.postActionBtn} ${isLikedByMe ? styles.liked : ''}`}
          onClick={toggleLikeHandler}
          aria-label="Like post"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill={isLikedByMe ? 'var(--color-primary)' : 'none'}
            stroke={isLikedByMe ? 'var(--color-primary)' : 'currentColor'}
            strokeWidth="2"
          >
            <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
          </svg>
          <span className={styles.postActionCount}>{likes}</span>
        </button>

        <button
          type="button"
          className={styles.postActionBtn}
          onClick={handleCommentHandler}
          aria-label="Comment on post"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
          </svg>
          <span className={styles.postActionCount}>{comments}</span>
        </button>

        <button
          type="button"
          className={styles.postActionBtn}
          onClick={handleShare}
          aria-label="Share post"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
          </svg>
          <span className={styles.shareText} style={{ fontSize: '0.85rem', fontWeight: 600 }}>Share</span>
        </button>

        <button
          type="button"
          className={`${styles.postActionBtn} ${isSaved ? styles.saved : ''}`}
          onClick={toggleSaveHandler}
          aria-label={isSaved ? 'Saved' : 'Save post'}
        >
          <Bookmark
            size={18}
            strokeWidth={2}
            color={isSaved ? 'var(--color-primary)' : undefined}
            fill={isSaved ? 'var(--color-primary)' : 'none'}
          />
          <span className={styles.shareText} style={{ fontSize: '0.85rem', fontWeight: 600 }}>{isSaved ? 'Saved' : 'Save'}</span>
        </button>
      </div>

      {showShareModal && (
        <SharePostModal
          isOpen={showShareModal}
          onClose={() => setShowShareModal(false)}
          post={post}
          author={author}
        />
      )}
    </>
  );
}

export default memo(PostActions);
