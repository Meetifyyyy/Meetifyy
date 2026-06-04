import { useState } from 'react';

export default function Post({ name, avatar, time, text, initialLikes = 0, initialComments = 0, communityTag }) {
  const [likes, setLikes] = useState(initialLikes);
  const [liked, setLiked] = useState(false);

  const toggleLike = () => {
    setLiked(!liked);
    setLikes(liked ? likes - 1 : likes + 1);
  };

  return (
    <div className="post">
      <div className="post-header">
        <div className="post-avatar">{avatar}</div>
        <div className="post-user">
          <div className="post-name">{name}</div>
          <div className="post-time">{time}</div>
        </div>
        {communityTag && (
          <span className="post-comm-tag" style={{ background: `${communityTag.color}18`, color: communityTag.color }}>
            {communityTag.name}
          </span>
        )}
      </div>
      <div className="post-body">{text}</div>
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
