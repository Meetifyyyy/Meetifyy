import { useNavigate } from 'react-router-dom';
import { useData } from '../../../context/DataContext';
import { cleanUrlDisplay } from '../../../utils/linkPreview';
import styles from './RichText.module.css';

export default function RichText({ content = '', mentions = [], className = '', urlLimit = 50 }) {
  const navigate = useNavigate();
  const { users = {} } = useData();

  if (!content) return null;

  // Helper to check if username exists in known users
  const isValidUser = (username) => {
    if (!username) return false;
    const clean = username.toLowerCase();
    return Object.keys(users).some(k => k.toLowerCase() === clean || (users[k].username && users[k].username.toLowerCase() === clean));
  };

  const handleMentionClick = (e, username) => {
    e.stopPropagation();
    if (username) {
      navigate(`/profile/${username}`);
    }
  };

  // Helper to parse URLs in text and return clickable links
  const renderTextWithLinks = (text, keyPrefix) => {
    if (!text) return null;
    const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/g;
    const parts = text.split(urlRegex);
    if (parts.length === 1) {
      return text;
    }
    return parts.map((part, idx) => {
      if (urlRegex.test(part)) {
        const puncMatch = part.match(/([.,!?;:]+)$/);
        let cleanPart = part;
        let trailingPunc = '';
        if (puncMatch) {
          cleanPart = part.slice(0, puncMatch.index);
          trailingPunc = puncMatch[0];
        }
        const href = cleanPart.startsWith('www.') ? `https://${cleanPart}` : cleanPart;
        
        // Clean display text using our algorithm
        const displayVal = cleanUrlDisplay(cleanPart);
        // Truncate based on urlLimit
        const truncatedDisplay = displayVal.length > urlLimit 
          ? displayVal.slice(0, urlLimit - 3) + '...' 
          : displayVal;

        return (
          <span key={`${keyPrefix}-link-container-${idx}`}>
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.urlLink}
              onClick={(e) => e.stopPropagation()}
            >
              {truncatedDisplay}
            </a>
            {trailingPunc}
          </span>
        );
      }
      return part;
    });
  };


  // 1. If structured mentions exist, slice by exact indices
  if (Array.isArray(mentions) && mentions.length > 0) {
    const sorted = [...mentions].sort((a, b) => a.start - b.start);
    const elements = [];
    let cursor = 0;

    sorted.forEach((m, idx) => {
      // Validate bounds and string match
      if (
        m &&
        typeof m.start === 'number' &&
        typeof m.end === 'number' &&
        m.start >= cursor &&
        m.end <= content.length
      ) {
        const sliceStr = content.slice(cursor, m.start);
        const expectedStr = `@${m.username}`;
        if (content.slice(m.start, m.end).toLowerCase() === expectedStr.toLowerCase()) {
          // Push text before mention
          if (m.start > cursor) {
            elements.push(
              <span key={`text-${cursor}`} className={styles.plainText}>
                {renderTextWithLinks(sliceStr, `text-${cursor}`)}
              </span>
            );
          }

          // Check if user still exists (or treat structured mention as valid if user ID is known)
          if (isValidUser(m.username) || users[m.username] || users[m.userId]) {
            elements.push(
              <span
                key={`mention-${idx}-${m.start}`}
                className={styles.mentionLink}
                onClick={(e) => handleMentionClick(e, m.username)}
                title={`Go to @${m.username}'s profile`}
              >
                {content.slice(m.start, m.end)}
              </span>
            );
          } else {
            // Deleted account gracefully shown as plain text
            elements.push(
              <span key={`deleted-${idx}-${m.start}`} className={styles.plainText}>
                {content.slice(m.start, m.end)}
              </span>
            );
          }

          cursor = m.end;
        }
      }
    });

    if (cursor < content.length) {
      elements.push(
        <span key={`text-${cursor}-end`} className={styles.plainText}>
          {renderTextWithLinks(content.slice(cursor), `text-${cursor}-end`)}
        </span>
      );
    }

    return <div className={`${styles.wrapper} ${className}`}>{elements}</div>;
  }

  // 2. Fallback regex matching for legacy text without structured mentions array
  const parts = content.split(/(@[a-zA-Z0-9_.-]+)/g);
  return (
    <div className={`${styles.wrapper} ${className}`}>
      {parts.map((part, idx) => {
        if (part.startsWith('@') && part.length > 1) {
          const username = part.slice(1);
          if (isValidUser(username)) {
            return (
              <span
                key={idx}
                className={styles.mentionLink}
                onClick={(e) => handleMentionClick(e, username)}
                title={`Go to @${username}'s profile`}
              >
                {part}
              </span>
            );
          }
        }
        return (
          <span key={idx} className={styles.plainText}>
            {renderTextWithLinks(part, `legacy-${idx}`)}
          </span>
        );
      })}
    </div>
  );
}
