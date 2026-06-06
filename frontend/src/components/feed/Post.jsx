import { useState } from 'react';
import { Link } from 'react-router-dom';
import { showToast } from '../../utils/toast';
import { useData } from '../../context/DataContext';
import styles from './Post.module.css';

function PollCard({ poll }) {
  const [votes, setVotes] = useState(() => poll.options.map(() => 0));
  const [selected, setSelected] = useState([]);
  const [hasVoted, setHasVoted] = useState(false);
  const totalVotes = votes.reduce((a, b) => a + b, 0);

  const handleVote = (idx) => {
    if (hasVoted) return;

    if (poll.multiSelect) {
      // Toggle selection without submitting yet
      setSelected((prev) =>
        prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]
      );
    } else {
      // Single select — vote immediately
      setSelected([idx]);
      setVotes((prev) => prev.map((v, i) => (i === idx ? v + 1 : v)));
      setHasVoted(true);
    }
  };

  const confirmMultiVote = () => {
    if (selected.length === 0 || hasVoted) return;
    setVotes((prev) => prev.map((v, i) => (selected.includes(i) ? v + 1 : v)));
    setHasVoted(true);
  };

  const showResults = hasVoted;

  return (
    <div className={styles.pollCard}>
      <div className={styles.pollCardHeader}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="9" y1="8" x2="9" y2="16" />
          <line x1="12" y1="11" x2="12" y2="16" />
          <line x1="15" y1="6" x2="15" y2="16" />
        </svg>
        <span className={styles.pollCardQuestion}>{poll.question}</span>
        {poll.multiSelect && <span className={styles.pollMultiBadge}>Multi</span>}
      </div>
      <div className={styles.pollCardOptions}>
        {poll.options.map((opt, i) => {
          const pct = showResults && totalVotes > 0 ? Math.round((votes[i] / totalVotes) * 100) : 0;
          const isSelected = selected.includes(i);

          return (
            <button
              key={i}
              className={`${styles.pollCardOption}${isSelected ? ` ${styles.selected}` : ''}${showResults ? ` ${styles.voted}` : ''}`}
              onClick={() => handleVote(i)}
              disabled={showResults}
            >
              <div className={styles.pollOptionFill} style={{ width: showResults ? `${pct}%` : '0%' }} />
              <span className={styles.pollOptionLabel}>
                {poll.multiSelect && !showResults && (
                  <span className={`${styles.pollCheckbox}${isSelected ? ` ${styles.checked}` : ''}`}>
                    {isSelected && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5"><polyline points="20 6 9 17 4 12" /></svg>}
                  </span>
                )}
                {opt}
              </span>
              {showResults && <span className={styles.pollOptionPct}>{pct}%</span>}
            </button>
          );
        })}
      </div>
      <div className={styles.pollCardFooter}>
        {poll.multiSelect && !hasVoted && selected.length > 0 && (
          <button className={styles.pollConfirmBtn} onClick={confirmMultiVote}>Confirm</button>
        )}
        <span className={styles.pollVoteCount}>{totalVotes} {totalVotes === 1 ? 'vote' : 'votes'}</span>
      </div>
    </div>
  );
}

export default function Post({ postData, communityTag, onClick }) {
  const { getUserById, likePost } = useData();
  const [showMenu, setShowMenu] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // For backward compatibility while refactoring, if postData is missing, fallback to props
  if (!postData) return null;

  const { id, authorId, time, text, poll, likes, comments, isLikedByMe } = postData;
  const author = getUserById(authorId) || { displayName: 'Unknown', username: 'unknown', avatar: '?' };

  const toggleLike = async (e) => {
    e.stopPropagation();
    if (isLoading) return;
    setIsLoading(true);
    await likePost(id);
    setIsLoading(false);
  };

  return (
    <div className={styles.post} onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }}>
      <div className={styles.postHeader}>
        <Link to={`/profile/${author.username}`} style={{ textDecoration: 'none' }} onClick={(e) => e.stopPropagation()}>
          <div className={styles.postAvatar}>{author.avatar}</div>
        </Link>
        <div className={styles.postUser}>
          <Link to={`/profile/${author.username}`} style={{ textDecoration: 'none', color: 'inherit', display: 'inline-block' }} onClick={(e) => e.stopPropagation()}>
            <div className={`hover-underline ${styles.postName}`}>{author.displayName}</div>
          </Link>
        <div className={styles.postTime} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span>@{author.username}</span>
            <span style={{ opacity: 0.5 }}>•</span>
            <span>{time}</span>
          </div>
        </div>
        {communityTag && (
          <span className={styles.postCommTag} style={{ background: `${communityTag.color}18`, color: communityTag.color }}>
            {communityTag.name}
          </span>
        )}
        <div style={{ position: 'relative', marginLeft: communityTag ? '0.5rem' : 'auto' }}>
          <button 
            onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0.2rem', borderRadius: '50%' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="19" cy="12" r="1.5" />
              <circle cx="5" cy="12" r="1.5" />
            </svg>
          </button>
          {showMenu && (
            <div className="dropdown open" style={{ right: 0, top: '100%', width: '120px' }}>
              <button 
                onClick={(e) => { e.stopPropagation(); showToast('Reported'); setShowMenu(false); }} 
                style={{ color: 'var(--color-danger)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line></svg>
                Report
              </button>
            </div>
          )}
        </div>
      </div>
      {text && <div className={styles.postBody}>{text}</div>}
      {poll && <div onClick={(e) => e.stopPropagation()}><PollCard poll={poll} /></div>}
      <div className={styles.postActions} style={{ marginTop: '0.5rem', paddingTop: '0' }}>
        <button className={styles.postActionBtn} onClick={toggleLike} disabled={isLoading} style={{ opacity: isLoading ? 0.5 : 1, ...(isLikedByMe ? { color: 'var(--color-primary)' } : {}) }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill={isLikedByMe ? 'var(--color-primary)' : 'none'} stroke="currentColor" strokeWidth="2">
            <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
          </svg>
          <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{likes}</span>
        </button>
        <button className={styles.postActionBtn} onClick={(e) => { e.stopPropagation(); if(onClick) onClick(); }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{comments}</span>
        </button>
        <button className={styles.postActionBtn} onClick={(e) => e.stopPropagation()}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 14 20 9 15 4" />
            <path d="M4 20v-7a4 4 0 0 1 4-4h12" />
          </svg>
          <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Share</span>
        </button>
      </div>
    </div>
  );
}
