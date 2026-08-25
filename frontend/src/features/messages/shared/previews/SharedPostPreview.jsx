import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Avatar from '@shared/components/avatar/Avatar';
import PostPreviewSkeleton from '@shared/components/skeletons/PostPreviewSkeleton';
import { BarChart2, FileX } from '@shared/components/icons';
import styles from './SharedPostPreview.module.css';
import { usePostLookup } from '@shared/hooks/usePostLookup';
import { useUsersMap } from '@shared/hooks/useUsersMap';
import { getMediaUrl } from '@shared/api/apiClient';

export function SharedPostPreview({ post, isLoading = false }) {
  const navigate = useNavigate();
  const getPostById = usePostLookup();
  // getUserById was defined as exactly `users[id] || null` over this same map.
  const usersMap = useUsersMap();
  const getUserById = (id) => usersMap[id] || null;
  const [imgError, setImgError] = useState(false);

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
  const authorUsername = liveAuthor?.username || post.authorUsername || post.username || null;
  const authorAvatar = liveAuthor?.avatar || post.authorAvatar;
  const contentText = livePost?.text || post.text || '';

  // Extract media items reliably
  const resolveMediaList = () => {
    let list = [];
    const rawMedia = (Array.isArray(livePost?.media) && livePost.media.length > 0) ? livePost.media : post?.media;
    if (Array.isArray(rawMedia) && rawMedia.length > 0) {
      list = rawMedia.map(m => {
        if (typeof m === 'string') return { url: getMediaUrl(m), type: 'image' };
        const rawUrl = m.url || (m.objectKey ? `/api/media/${m.objectKey}` : null) || (m.storageKey ? `/api/media/${m.storageKey}` : null) || (m.path ? `/api/media/${m.path}` : null);
        return { ...m, url: getMediaUrl(rawUrl) };
      }).filter(m => m.url);
    } else if (Array.isArray(livePost?.images) && livePost.images.length > 0) {
      list = livePost.images.map(img => ({
        url: getMediaUrl(typeof img === 'string' ? img : (img.url || (img.objectKey ? `/api/media/${img.objectKey}` : null) || (img.storageKey ? `/api/media/${img.storageKey}` : null))),
        type: 'image'
      })).filter(m => m.url);
    } else if (Array.isArray(post?.images) && post.images.length > 0) {
      list = post.images.map(img => ({
        url: getMediaUrl(typeof img === 'string' ? img : (img.url || (img.objectKey ? `/api/media/${img.objectKey}` : null) || (img.storageKey ? `/api/media/${img.storageKey}` : null))),
        type: 'image'
      })).filter(m => m.url);
    } else {
      const singleUrl = post?.image || post?.mediaUrl || post?.mediaKey || livePost?.image || livePost?.mediaUrl || livePost?.mediaKey || (typeof rawMedia === 'string' ? rawMedia : (rawMedia?.url || rawMedia?.objectKey || rawMedia?.storageKey || rawMedia?.path));
      if (singleUrl) {
        const rawUrl = typeof singleUrl === 'string' ? singleUrl : (singleUrl.url || (singleUrl.objectKey ? `/api/media/${singleUrl.objectKey}` : null) || (singleUrl.storageKey ? `/api/media/${singleUrl.storageKey}` : null));
        if (rawUrl) {
          list = [{ url: getMediaUrl(rawUrl), type: post?.mediaType || livePost?.mediaType || 'image' }];
        }
      }
    }
    return list;
  };

  const mediaList = resolveMediaList();
  const primaryMedia = mediaList.length > 0 ? mediaList[0] : null;

  // Extract poll data reliably
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

  const getOptionVotes = (o) => {
    if (!o || typeof o !== 'object') return 0;
    const count = o.voteCount !== undefined ? o.voteCount : (o.votes !== undefined ? o.votes : (o._count?.votes || 0));
    return Number(count) || 0;
  };

  const resolvePollData = () => {
    const livePollValid = livePost?.poll && Array.isArray(livePost.poll.options) && livePost.poll.options.length > 0;
    const postPollValid = post?.poll && Array.isArray(post.poll.options) && post.poll.options.length > 0;

    if (livePollValid) return livePost.poll;
    if (postPollValid) return post.poll;

    const optionsSrc = (Array.isArray(livePost?.pollOptions) && livePost.pollOptions.length > 0)
      ? livePost.pollOptions
      : (Array.isArray(post?.pollOptions) && post.pollOptions.length > 0 ? post.pollOptions : null);

    if (optionsSrc) {
      const options = optionsSrc.map(opt => ({
        id: typeof opt === 'object' ? opt?.id : undefined,
        text: getOptionText(opt),
        votes: getOptionVotes(opt)
      }));
      const questionRaw = livePost?.pollQuestion || post?.pollQuestion || livePost?.text || post?.text || 'Poll';
      return {
        question: typeof questionRaw === 'string' ? questionRaw : getOptionText(questionRaw),
        options,
        totalVotes: options.reduce((sum, o) => sum + o.votes, 0)
      };
    }
    return null;
  };

  const pollData = resolvePollData();

  const rawDate = livePost?.createdAt || post.createdAt || post.timestamp || livePost?.timestamp;
  const formatExactDateTime = (ts) => {
    if (!ts) return post.time || 'Recent';
    const date = new Date(ts);
    if (isNaN(date.getTime())) return post.time || String(ts);
    const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
    const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    return `${dateStr} • ${timeStr}`;
  };

  const exactDateTime = formatExactDateTime(rawDate);

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
        <Avatar src={authorAvatar} name={authorName} size="32px" />
        <div className={styles.authorMeta}>
          <span className={styles.authorName}>{authorName}</span>
          {authorUsername && (
            <span className={styles.authorUsername}>@{authorUsername.replace(/^@/, '')}</span>
          )}
        </div>
      </div>

      {contentText && (
        <div className={styles.twoLineContent} title={contentText}>
          {contentText}
        </div>
      )}

      {primaryMedia && !imgError && (
        <div className={styles.mediaPreviewContainer}>
          <img 
            src={primaryMedia.url} 
            alt="" 
            className={styles.mediaPreviewImg} 
            loading="lazy" 
            onError={() => setImgError(true)}
          />
          {mediaList.length > 1 && (
            <span className={styles.mediaBadge}>+{mediaList.length - 1} more</span>
          )}
        </div>
      )}

      {pollData && (
        <div className={styles.pollPreviewWidget}>
          <div className={styles.pollHeader}>
            <BarChart2 size={15} />
            <span>Poll: {typeof pollData.question === 'string' ? pollData.question : getOptionText(pollData.question) || 'Question'}</span>
          </div>
          <div className={styles.pollOptionsList}>
            {pollData.options.slice(0, 4).map((opt, idx) => {
              const optText = getOptionText(opt);
              const votes = typeof opt === 'object' ? (opt.votes || 0) : 0;
              const total = pollData.totalVotes || 0;
              const pct = total > 0 ? Math.round((votes / total) * 100) : 0;
              return (
                <div key={opt.id || idx} className={styles.pollOptionItem}>
                  {total > 0 && <div className={styles.pollOptionFill} style={{ width: `${pct}%` }} />}
                  <span className={styles.pollOptionText}>{optText}</span>
                  {total > 0 && <span className={styles.pollOptionVotes}>{pct}%</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className={styles.metaRow}>
        <span className={styles.timestampText}>{exactDateTime}</span>
      </div>
    </div>
  );
}
