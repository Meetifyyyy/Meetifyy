import { useState, useEffect } from 'react';
import { useData } from '../../context/DataContext';
import { isImageUrl } from '../../utils/avatar';
import DefaultAvatar from '../common/DefaultAvatar';
import MentionInput from '../common/mentions/MentionInput';
import Post from './Post';
import CommentNode from './CommentNode';
import styles from './PostView.module.css';

// Persistent set to track posts whose comments have already been loaded once
const loadedCommentsPosts = new Set();

export default function PostView({ post, onBack }) {
  const [replyContent, setReplyContent] = useState({ text: '', mentions: [] });
  const { getPostById, addComment, currentUser } = useData();

  // post passed in props might just be the initial reference, we should fetch live from context
  const livePost = post ? getPostById(post.id) : null;

  const [commentsLoading, setCommentsLoading] = useState(() => {
    if (!livePost) return false;
    return !loadedCommentsPosts.has(livePost.id);
  });

  useEffect(() => {
    if (!livePost) return;
    if (loadedCommentsPosts.has(livePost.id)) {
      setCommentsLoading(false);
      return;
    }

    setCommentsLoading(true);
    const timer = setTimeout(() => {
      loadedCommentsPosts.add(livePost.id);
      setCommentsLoading(false);
    }, 600); // 600ms simulated load for comments

    return () => clearTimeout(timer);
  }, [livePost?.id]);

  if (!livePost) return null;

  // Handles adding a reply to the main post
  const handleMainReplySubmit = (e) => {
    if (e?.preventDefault) e.preventDefault();
    if (!replyContent.text.trim()) return;
    addComment(livePost.id, replyContent.text, null, replyContent.mentions);
    setReplyContent({ text: '', mentions: [] });
  };

  // Handles adding a reply to a specific comment recursively
  const handleCommentReplySubmit = (parentId, text, mentions) => {
    addComment(livePost.id, text, parentId, mentions);
  };

  useEffect(() => {
    const el = document.getElementById('reply-composer');
    if (el) {
      el.focus();
    }
  }, [livePost.id]);

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
        <Post postData={livePost} isDetailed={true} onClick={() => document.getElementById('reply-composer')?.focus()} />
      </div>

      {/* Reply Composer (Top Level) */}
      <div className={styles.postViewComposer}>
        <div className={styles.composerAvatar}>
          {isImageUrl(currentUser.avatar) ? (
            <img src={currentUser.avatar} alt={currentUser.displayName} className={styles.composerAvatarImg} />
          ) : (
            <DefaultAvatar />
          )}
        </div>
        <form onSubmit={handleMainReplySubmit} className={styles.replyForm}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <MentionInput
              placeholder="Post your reply..." 
              value={replyContent}
              onChange={setReplyContent}
              onSubmit={handleMainReplySubmit}
              className={styles.replyTextarea}
              singleLine={false}
            />
          </div>
          <div className={styles.replyActions}>
            <button 
              type="submit" 
              disabled={!replyContent.text.trim()} 
              className={`${styles.replyBtn} ${replyContent.text.trim() ? styles.replyBtnActive : styles.replyBtnDisabled}`}
            >
              Reply
            </button>
          </div>
        </form>
      </div>

      {/* Replies List */}
      <div className={styles.postViewReplies}>
        {commentsLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '2rem 0' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="3" strokeLinecap="round" style={{ animation: 'spin 0.8s linear infinite' }}>
              <circle cx="12" cy="12" r="10" stroke="rgba(0,0,0,0.05)" strokeWidth="3" />
              <path d="M12 2a10 10 0 0 1 10 10" />
            </svg>
          </div>
        ) : (
          replies.map((reply, idx) => (
            <CommentNode 
              key={reply.id} 
              postId={livePost.id}
              comment={reply} 
              onReplySubmit={handleCommentReplySubmit} 
              level={0}
              isLastInThread={idx === replies.length - 1 && (!reply.replies || reply.replies.length === 0)}
            />
          ))
        )}
      </div>
    </div>
  );
}
