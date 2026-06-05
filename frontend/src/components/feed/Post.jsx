import { useState } from 'react';
import { Link } from 'react-router-dom';

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
    <div className="poll-card">
      <div className="poll-card-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="9" y1="8" x2="9" y2="16" />
          <line x1="12" y1="11" x2="12" y2="16" />
          <line x1="15" y1="6" x2="15" y2="16" />
        </svg>
        <span className="poll-card-question">{poll.question}</span>
        {poll.multiSelect && <span className="poll-multi-badge">Multi</span>}
      </div>
      <div className="poll-card-options">
        {poll.options.map((opt, i) => {
          const pct = showResults && totalVotes > 0 ? Math.round((votes[i] / totalVotes) * 100) : 0;
          const isSelected = selected.includes(i);

          return (
            <button
              key={i}
              className={`poll-card-option ${isSelected ? 'selected' : ''} ${showResults ? 'voted' : ''}`}
              onClick={() => handleVote(i)}
              disabled={showResults}
            >
              <div className="poll-option-fill" style={{ width: showResults ? `${pct}%` : '0%' }} />
              <span className="poll-option-label">
                {poll.multiSelect && !showResults && (
                  <span className={`poll-checkbox ${isSelected ? 'checked' : ''}`}>
                    {isSelected && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5"><polyline points="20 6 9 17 4 12" /></svg>}
                  </span>
                )}
                {opt}
              </span>
              {showResults && <span className="poll-option-pct">{pct}%</span>}
            </button>
          );
        })}
      </div>
      <div className="poll-card-footer">
        {poll.multiSelect && !hasVoted && selected.length > 0 && (
          <button className="poll-confirm-btn" onClick={confirmMultiVote}>Confirm</button>
        )}
        <span className="poll-vote-count">{totalVotes} {totalVotes === 1 ? 'vote' : 'votes'}</span>
      </div>
    </div>
  );
}

export default function Post({ name, avatar, time, text, poll, initialLikes = 0, initialComments = 0, communityTag }) {
  const [likes, setLikes] = useState(initialLikes);
  const [liked, setLiked] = useState(false);

  const toggleLike = () => {
    setLiked(!liked);
    setLikes(liked ? likes - 1 : likes + 1);
  };

  const username = name.toLowerCase().replace(/\s+/g, '');

  return (
    <div className="post">
      <div className="post-header">
        <Link to={`/profile/${username}`} style={{ textDecoration: 'none' }}>
          <div className="post-avatar">{avatar}</div>
        </Link>
        <div className="post-user">
          <Link to={`/profile/${username}`} style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="post-name">{name}</div>
          </Link>
          <div className="post-time">{time}</div>
        </div>
        {communityTag && (
          <span className="post-comm-tag" style={{ background: `${communityTag.color}18`, color: communityTag.color }}>
            {communityTag.name}
          </span>
        )}
      </div>
      {text && <div className="post-body">{text}</div>}
      {poll && <PollCard poll={poll} />}
      <div className="post-stats">
        <span><strong>{likes}</strong> likes</span>
        <span><strong>{initialComments}</strong> comments</span>
      </div>
      <div className="post-actions">
        <button className="post-action-btn" onClick={toggleLike} style={liked ? { color: '#6D5DFC' } : {}}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
          </svg>
          Like
        </button>
        <button className="post-action-btn">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          Comment
        </button>
        <button className="post-action-btn">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
          </svg>
          Share
        </button>
      </div>
    </div>
  );
}
