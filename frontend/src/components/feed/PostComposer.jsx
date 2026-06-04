import { useState, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';

export default function PostComposer({ onSubmit }) {
  const { initial } = useAuth();
  const [value, setValue] = useState('');
  const inputRef = useRef(null);

  const handlePost = () => {
    const text = value.trim();
    if (!text) return;
    onSubmit(text);
    setValue('');
  };

  return (
    <div className="post-composer">
      <div className="composer-avatar">{initial}</div>
      <div className="composer-input-wrap">
        <input
          ref={inputRef}
          type="text"
          className="composer-input"
          placeholder="What's on your mind?"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handlePost(); }}
        />
        <div className="composer-actions">
          <button className="composer-btn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            Photo
          </button>
          <button className="composer-btn" onClick={handlePost}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            Post
          </button>
        </div>
      </div>
    </div>
  );
}
