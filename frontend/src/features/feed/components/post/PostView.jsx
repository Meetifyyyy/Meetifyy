import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { postsApi } from '@shared/api/apiClient';

import { isImageUrl } from '@shared/utils/avatar';
import DefaultAvatar from '@shared/components/avatar/DefaultAvatar';
import Avatar from '@shared/components/avatar/Avatar';
import MentionInput from '@shared/components/mentions/MentionInput';
import Post from './Post';
import { CommentTreeRoot } from './CommentNode';
import styles from './PostView.module.css';
import { useData } from '@shared/hooks/useData';

function buildCommentTree(comments) {
  if (!comments || !Array.isArray(comments)) return [];
  const map = {};
  const roots = [];
  
  comments.forEach(c => {
    map[c.id] = { ...c, replies: [] };
  });
  
  comments.forEach(c => {
    if (c.parentId && map[c.parentId]) {
      map[c.parentId].replies.push(map[c.id]);
    } else {
      roots.push(map[c.id]);
    }
  });
  
  return roots;
}

export default function PostView({ post, onBack }) {
  const [replyContent, setReplyContent] = useState({ text: '', mentions: [] });
  const { addComment, currentUser } = useData();

  const { data: fetchedPost, isLoading: isFetchingPost } = useQuery({
    queryKey: ['post', post?.id],
    queryFn: () => postsApi.getPostById(post.id),
    enabled: !!post?.id,
    staleTime: 30_000,
  });


  const livePost = fetchedPost || post;
  
  const commentsLoading = isFetchingPost && !fetchedPost;

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

  const replies = useMemo(() => {
    if (livePost.comments) return buildCommentTree(livePost.comments);
    return livePost.replies || [];
  }, [livePost.comments, livePost.replies]);

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
        <Avatar src={currentUser?.avatar} name={currentUser?.displayName} size="40px" disableHover />
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
          <CommentTreeRoot
            postId={livePost.id}
            comments={replies}
            onReplySubmit={handleCommentReplySubmit}
          />
        )}
      </div>
    </div>
  );
}
