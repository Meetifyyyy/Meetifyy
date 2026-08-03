import { useNavigate } from 'react-router-dom';
import Avatar from '@shared/components/avatar/Avatar';
import PostPreviewSkeleton from '@shared/components/skeletons/PostPreviewSkeleton';
import { Image as ImageIcon, BarChart2, FileX } from 'lucide-react';
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
  const authorUsername = liveAuthor?.username || post.authorUsername || post.username || null;
  const authorAvatar = liveAuthor?.avatar || post.authorAvatar;
  const contentText = livePost?.text || post.text || '';

  // Extract media items reliably
  const resolveMediaList = () => {
    let list = [];
    const rawMedia = livePost?.media || post?.media;
    if (Array.isArray(rawMedia) && rawMedia.length > 0) {
      list = rawMedia.map(m => {
        if (typeof m === 'string') return { url: m, type: 'image' };
        const url = m.url || (m.objectKey ? `/api/media/${m.objectKey}` : null);
        return { ...m, url };
      }).filter(m => m.url);
    } else if (Array.isArray(livePost?.images) || Array.isArray(post?.images)) {
      const imgs = livePost?.images || post?.images || [];
      list = imgs.map(img => {
        const url = typeof img === 'string' ? img : (img.url || (img.objectKey ? `/api/media/${img.objectKey}` : null));
        return { url, type: 'image' };
      }).filter(m => m.url);
    } else {
      const singleUrl = post?.image || post?.mediaUrl || (typeof rawMedia === 'string' ? rawMedia : rawMedia?.url);
      if (singleUrl) {
        list = [{ url: singleUrl, type: post?.mediaType || 'image' }];
      }
    }
    return list;
  };

  const mediaList = resolveMediaList();
  const primaryMedia = mediaList.length > 0 ? mediaList[0] : null;

  // Extract poll data reliably
  const resolvePollData = () => {
    const pollObj = livePost?.poll || post?.poll;
    if (pollObj && Array.isArray(pollObj.options) && pollObj.options.length > 0) {
      return pollObj;
    }
    const optionsSrc = livePost?.pollOptions || post?.pollOptions;
    if (Array.isArray(optionsSrc) && optionsSrc.length > 0) {
      const getOptionText = (o) => {
        if (!o) return '';
        if (typeof o === 'string') return o;
        if (typeof o.text === 'string') return o.text;
        if (typeof o.text === 'object' && o.text !== null) return getOptionText(o.text);
        return String(o.label || o.title || '');
      };
      const getOptionVotes = (o) => {
        if (!o || typeof o !== 'object') return 0;
        const count = o.voteCount !== undefined ? o.voteCount : (o.votes !== undefined ? o.votes : (o._count?.votes || 0));
        return Number(count) || 0;
      };
      const options = optionsSrc.map(opt => ({
        id: typeof opt === 'object' ? opt?.id : undefined,
        text: getOptionText(opt),
        votes: getOptionVotes(opt)
      }));
      return {
        question: livePost?.pollQuestion || post?.pollQuestion || 'Poll',
        options,
        totalVotes: options.reduce((sum, o) => sum + o.votes, 0)
      };
    }
    return null;
  };

  const pollData = resolvePollData();

  const getOptionText = (o) => {
    if (!o) return '';
    if (typeof o === 'string') return o;
    if (typeof o.text === 'string') return o.text;
    if (typeof o.text === 'object' && o.text !== null) return getOptionText(o.text);
    return String(o.label || o.title || '');
  };

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

      {primaryMedia && (
        <div className={styles.mediaPreviewContainer}>
          <img src={primaryMedia.url} alt="" className={styles.mediaPreviewImg} loading="lazy" />
          {mediaList.length > 1 && (
            <span className={styles.mediaBadge}>+{mediaList.length - 1} more</span>
          )}
        </div>
      )}

      {pollData && (
        <div className={styles.pollPreviewWidget}>
          <div className={styles.pollHeader}>
            <BarChart2 size={15} />
            <span>Poll: {pollData.question || 'Question'}</span>
          </div>
          <div className={styles.pollOptionsList}>
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
