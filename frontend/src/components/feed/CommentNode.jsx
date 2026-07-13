import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../../context/DataContext';
import { showToast } from '../../utils/toast';
import { isImageUrl } from '../../utils/avatar';
import DefaultAvatar from '../common/DefaultAvatar';
import MentionInput from '../common/mentions/MentionInput';
import RichText from '../common/mentions/RichText';
import { timeAgo } from '../../utils/time';
import styles from './CommentNode.module.css';

export default function CommentNode({ postId, comment, onReplySubmit, level = 0, isLastInThread = false }) {
  const [isReplying, setIsReplying] = useState(false);
  const [replyContent, setReplyContent] = useState({ text: '', mentions: [] });
  const [showMenu, setShowMenu] = useState(false);
  const [isLiking, setIsLiking] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();
  const { getUserById, likeComment, deleteComment, communities, currentUser } = useData();

  const author = getUserById(comment.authorId) || { displayName: 'Unknown', username: 'unknown', avatar: '?' };
  const authorCollege = author.collegeId ? communities[author.collegeId] : null;

  const handleProfileClick = () => {
    navigate(`/profile/${author.username}`);
  };

  const handleReplyClick = () => {
    setIsReplying(!isReplying);
    setReplyContent({ text: '', mentions: [] }); // Clear input when toggling
  };

  const handleCancelReply = () => {
    setIsReplying(false);
    setReplyContent({ text: '', mentions: [] });
  };

  const handleSubmit = async () => {
    if (!replyContent.text.trim() || isSubmitting) return;
    setIsSubmitting(true);
    await onReplySubmit(comment.id, replyContent.text, replyContent.mentions);
    setIsSubmitting(false);
    setIsReplying(false);
    setReplyContent({ text: '', mentions: [] });
  };

  const handleLike = () => {
    likeComment(postId, comment.id);
  };

  const { likes, isLikedByMe: rawIsLiked } = comment;
  const isLikedByMe = comment.likedBy ? comment.likedBy.includes(currentUser?.id) : !!rawIsLiked;

  return (
    <div className={`${styles.nodeContainer} ${level === 0 ? styles.level0 : styles.levelN}`}>
      <div className={styles.replyWrapper}>
        <div 
          className={styles.replyAvatar} 
          onClick={handleProfileClick}
        >
          {isImageUrl(author.avatar) ? (
            <img src={author.avatar} alt={author.displayName} className={styles.replyAvatarImg} />
          ) : (
            <DefaultAvatar />
          )}
        </div>
        
        <div className={styles.replyContent}>
          <div className={styles.replyHeader}>
            <div className={styles.replyIdentity}>
              <button 
                onClick={handleProfileClick}
                className={`hover-underline ${styles.nameButton}`}
              >
                <span className={styles.username}>{author.displayName}</span>
                {authorCollege && (
                  <img
                    src={authorCollege.avatar}
                    alt={authorCollege.name}
                    className={styles.commentCollegeIcon}
                    title={authorCollege.name}
                  />
                )}
              </button>
              <div className={styles.commentMeta}>
                <span className={styles.handle}>@{author.username}</span>
                <span className={styles.metaDot}>·</span>
                <span className={styles.time}>{comment.createdAt ? timeAgo(comment.createdAt) : comment.time}</span>
              </div>
            </div>
            <div className={styles.menuWrapper}>
              <button 
                onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
                className={styles.menuBtn}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="1.5" />
                  <circle cx="19" cy="12" r="1.5" />
                  <circle cx="5" cy="12" r="1.5" />
                </svg>
              </button>
              {showMenu && (
                <div className="dropdown open" style={{ right: 0, top: '100%', width: '120px' }}>
                  {currentUser && comment.authorId === currentUser.id && (() => {
                    const commentTimestamp = typeof comment.id === 'string' && comment.id.startsWith('r_') ? parseInt(comment.id.split('_')[1], 10) : 0;
                    const canDelete = (Date.now() - commentTimestamp) <= 5 * 60 * 1000;
                    
                    return canDelete ? (
                      <button 
                        onClick={async (e) => { 
                          e.stopPropagation(); 
                          setShowMenu(false); 
                          if (deleteComment) await deleteComment(postId, comment.id); 
                        }} 
                        style={{ color: 'var(--color-danger)' }}
                        className={styles.reportBtn}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                        Delete
                      </button>
                    ) : null;
                  })()}
                  <button 
                    onClick={(e) => { e.stopPropagation(); showToast('Reported'); setShowMenu(false); }} 
                    style={{ color: 'var(--color-text-main)' }}
                    className={styles.reportBtn}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line></svg>
                    Report
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className={styles.replyText}>
            <RichText content={comment.text} mentions={comment.mentions} urlLimit={30} />
          </div>
          <div className={styles.replyActionsRow}>
            <button 
              onClick={handleLike}
              className={`${styles.actionBtn} ${isLikedByMe ? styles.actionBtnLiked : ''}`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill={isLikedByMe ? 'var(--color-primary)' : 'none'} stroke={isLikedByMe ? 'var(--color-primary)' : 'currentColor'} strokeWidth="2.5"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" /></svg>
              {likes}
            </button>
            <button 
              onClick={handleReplyClick}
              className={styles.actionBtn}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 14 20 9 15 4" /><path d="M4 20v-7a4 4 0 0 1 4-4h12" /></svg>
              Reply
            </button>
          </div>

          {/* Inline Reply Composer */}
          {isReplying && (
            <div className={styles.inlineComposerContainer}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <MentionInput 
                  placeholder={`Reply to @${author.username}`}
                  value={replyContent}
                  onChange={setReplyContent}
                  onSubmit={handleSubmit}
                  className={styles.inlineTextarea}
                  singleLine={false}
                />
              </div>
              <div className={styles.inlineActions}>
                <button 
                  onClick={handleCancelReply}
                  className={styles.cancelBtn}
                >
                  Cancel
                </button>
                <button 
                  onClick={handleSubmit}
                  disabled={!replyContent.text.trim() || isSubmitting} 
                  className={`${styles.submitBtn} ${replyContent.text.trim() && !isSubmitting ? styles.submitBtnActive : styles.submitBtnDisabled}`}
                >
                  {isSubmitting ? '...' : 'Comment'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Render children comments indented */}
      {comment.replies && comment.replies.length > 0 && (
        <div className={styles.repliesContainer}>
          {comment.replies.map((childReply, idx) => (
            <CommentNode 
              key={childReply.id} 
              postId={postId}
              comment={childReply} 
              onReplySubmit={onReplySubmit} 
              level={level + 1}
              isLastInThread={idx === comment.replies.length - 1 && (!childReply.replies || childReply.replies.length === 0)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

