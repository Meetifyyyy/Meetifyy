import React from 'react';
import { useNavigate } from 'react-router-dom';
import { isImageUrl } from '../../utils/avatar';
import DefaultAvatar from '../common/DefaultAvatar';
import { getRelativeDateLabel } from '../../utils/time';
import styles from './SearchResultCards.module.css';

// Helper component to render highlighted text from Fuse.js matches
const HighlightedText = ({ text, matches, keyName }) => {
  if (!matches || matches.length === 0) return <>{text}</>;

  const match = matches.find(m => m.key === keyName);
  if (!match) return <>{text}</>;

  // Construct highlighted string
  let lastIndex = 0;
  const elements = [];
  
  match.indices.forEach(([start, end], idx) => {
    // Add text before match
    if (start > lastIndex) {
      elements.push(<span key={`text-${idx}`}>{text.substring(lastIndex, start)}</span>);
    }
    // Add highlighted match
    elements.push(
      <span key={`highlight-${idx}`} className={styles.highlight}>
        {text.substring(start, end + 1)}
      </span>
    );
    lastIndex = end + 1;
  });

  // Add remaining text
  if (lastIndex < text.length) {
    elements.push(<span key="text-last">{text.substring(lastIndex)}</span>);
  }

  return <>{elements}</>;
};

export function PostResult({ result, isSelected, onClick }) {
  const { item, matches } = result;
  
  return (
    <button 
      className={styles.resultCard} 
      data-selected={isSelected} 
      onClick={() => onClick(`/post/${item.id}`)}
      onKeyDown={(e) => e.key === 'Enter' && onClick(`/post/${item.id}`)}
    >
      <div className={styles.content}>
        <div className={styles.postText}>
          <HighlightedText text={item.text} matches={matches} keyName="text" />
        </div>
        <div className={styles.postMeta}>
          <span className={styles.subtitle}>
            {item.authorName}
          </span>
          {item.communityName && (
            <>
              <span className={styles.dot} />
              <span className={styles.postCommunity}>{item.communityName}</span>
            </>
          )}
          <span className={styles.dot} />
          <span>{item.likes} likes</span>
        </div>
      </div>
    </button>
  );
}

export function CommunityResult({ result, isSelected, onClick }) {
  const { item, matches } = result;
  
  return (
    <button 
      className={styles.resultCard} 
      data-selected={isSelected} 
      onClick={() => onClick(`/communities/${item.id}`)}
    >
      <div 
        className={styles.avatar} 
        style={item.color ? { background: item.color } : {}}
      >
        {isImageUrl(item.avatar) ? (
           <img src={item.avatar} alt={item.name} className={styles.avatar} />
        ) : (
          <DefaultAvatar />
        )}
      </div>
      <div className={styles.content}>
        <div className={styles.title}>
          <HighlightedText text={item.name} matches={matches} keyName="name" />
        </div>
        <div className={styles.subtitle}>
          {item.members} members
        </div>
      </div>
    </button>
  );
}

export function UserResult({ result, isSelected, onClick }) {
  const { item, matches } = result;
  
  return (
    <button 
      className={styles.resultCard} 
      data-selected={isSelected} 
      onClick={() => onClick(`/profile/${item.username}`)}
    >
      <div className={styles.avatar}>
        {isImageUrl(item.avatar) ? (
          <img src={item.avatar} alt={item.displayName} className={styles.avatar} />
        ) : (
          <DefaultAvatar />
        )}
      </div>
      <div className={styles.content}>
        <div className={styles.title}>
          <HighlightedText text={item.displayName} matches={matches} keyName="displayName" />
        </div>
        <div className={styles.subtitle}>
          @{item.username}
          {item.course && (
            <>
              <span className={styles.dot} />
              {item.course}
            </>
          )}
        </div>
      </div>
    </button>
  );
}

export function CollegeResult({ result, isSelected, onClick }) {
  const { item, matches } = result;
  
  return (
    <button 
      className={styles.resultCard} 
      data-selected={isSelected} 
      onClick={() => onClick(`/campus`)}
    >
      <div 
        className={`${styles.avatar} ${styles.collegeAvatar}`} 
        style={item.color ? { background: item.color } : {}}
      >
        {isImageUrl(item.avatar) ? (
           <img src={item.avatar} alt={item.name} className={`${styles.avatar} ${styles.collegeAvatar}`} />
        ) : (
          <DefaultAvatar isGroup={true} />
        )}
      </div>
      <div className={styles.content}>
        <div className={styles.title}>
          <HighlightedText text={item.name} matches={matches} keyName="name" />
        </div>
        <div className={styles.subtitle}>
          {item.members} members
          {item.posts && (
            <>
              <span className={styles.dot} />
              {item.posts.length} communities
            </>
          )}
        </div>
      </div>
    </button>
  );
}

export function CrewResult({ result, isSelected, onClick }) {
  const { item, matches } = result;
  
  return (
    <button 
      className={styles.resultCard} 
      data-selected={isSelected} 
      onClick={() => onClick(`/crew/${item.id}`)}
    >
      <div className={styles.avatar} style={{ borderRadius: '10px', background: 'linear-gradient(135deg, #2563EB, #7C3AED)' }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-bg-white)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
      </div>
      <div className={styles.content}>
        <div className={styles.title}>
          <HighlightedText text={item.title} matches={matches} keyName="title" />
        </div>
        <div className={styles.subtitle}>
          <span className={styles.postCommunity}>{item.category}</span>
          <span className={styles.dot} />
          <span>{item.hostName}</span>
          <span className={styles.dot} />
          <span>{getRelativeDateLabel(item.date) || item.dateLabel}</span>
        </div>
      </div>
    </button>
  );
}
