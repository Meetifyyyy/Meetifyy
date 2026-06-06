import { useState } from 'react';
import { useData } from '../../context/DataContext';
import Post from './Post';
import CommentNode from './CommentNode';
import styles from './PostView.module.css';

export default function PostView({ post, onBack }) {
  const [replyText, setReplyText] = useState('');
  const { getPostById, addComment, currentUser } = useData();

  // post passed in props might just be the initial reference, we should fetch live from context
  const livePost = post ? getPostById(post.id) : null;

  if (!livePost) return null;

  // Handles adding a reply to the main post
  const handleMainReplySubmit = (e) => {
    e.preventDefault();
    if (!replyText.trim()) return;
    addComment(livePost.id, replyText);
    setReplyText('');
  };

  // Handles adding a reply to a specific comment recursively
  const handleCommentReplySubmit = (parentId, text) => {
    addComment(livePost.id, text, parentId);
  };

  const replies = livePost.replies || [];

  return (
    <div className={styles.postViewContainer}>
      
      {/* Top Bar */}
      <div className={styles.postViewTopbar}>
        <button onClick={onBack} className={styles.postBackBtn}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
        </button>
        <h2 className={styles.postViewTitle}>Post</h2>
      </div>

      {/* Main Post */}
      <div className={`${styles.postViewMain} comm-feed-integrated`}>
        <Post postData={livePost} onClick={() => document.getElementById('reply-composer').focus()} />
      </div>

      {/* Reply Composer (Top Level) */}
      <div className={styles.postViewComposer}>
        <div className={styles.composerAvatar}>{currentUser.avatar}</div>
        <form onSubmit={handleMainReplySubmit} className={styles.replyForm}>
          <textarea 
            id="reply-composer"
            placeholder="Post your reply..." 
            value={replyText}
            onChange={(e) => {
              setReplyText(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = (e.target.scrollHeight) + 'px';
            }}
            rows={1}
            className={styles.replyTextarea}
          />
          <div className={styles.replyActions}>
            <button 
              type="submit" 
              disabled={!replyText.trim()} 
              className={`${styles.replyBtn} ${replyText.trim() ? styles.replyBtnActive : styles.replyBtnDisabled}`}
            >
              Reply
            </button>
          </div>
        </form>
      </div>

      {/* Replies List */}
      <div className={styles.postViewReplies}>
        {replies.map((reply, idx) => (
          <CommentNode 
            key={reply.id} 
            postId={livePost.id}
            comment={reply} 
            onReplySubmit={handleCommentReplySubmit} 
            level={0}
            isLastInThread={idx === replies.length - 1 && (!reply.replies || reply.replies.length === 0)}
          />
        ))}
      </div>
    </div>
  );
}
