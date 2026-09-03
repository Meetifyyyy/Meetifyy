import { useNavigate } from 'react-router-dom';

import {
  createUrlMatcher,
  formatUrlForDisplay,
  resolveHref,
  splitTrailingPunctuation,
  truncateUrlLabel,
} from '@shared/utils/postLinks';
import styles from './RichText.module.css';
import { useUsersMap } from '@shared/hooks/useUsersMap';


/**
 * Wrap every case-insensitive occurrence of `term` in a <mark>.
 *
 * Applied only to leaf text nodes, so mentions and links keep their own
 * rendering and their own click handlers — highlighting must never turn a
 * working @mention or URL into inert marked-up text.
 */
export function markMatches(text, term, keyPrefix, markClass) {
  if (!term || !text || typeof text !== 'string') return text;
  const needle = term.toLowerCase();
  const haystack = text.toLowerCase();
  if (!haystack.includes(needle)) return text;

  const out = [];
  let cursor = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    if (at > cursor) out.push(text.slice(cursor, at));
    out.push(
      <mark key={`${keyPrefix}-hit-${at}`} className={markClass}>
        {text.slice(at, at + term.length)}
      </mark>
    );
    cursor = at + term.length;
    at = haystack.indexOf(needle, cursor);
  }
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}

export default function RichText({ content = '', mentions = [], className = '', urlLimit = 50, highlight = '' }) {
  const navigate = useNavigate();
  // useUsersMap() always returns an object, so the `= {}` default is no longer needed.
  const users = useUsersMap();

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

  /**
   * Linkify the URLs in a run of text.
   *
   * Walks matches with `exec` rather than `split(/…/g)` + `.test()`. That old
   * pairing was broken in a way that was easy to miss: `.test()` on a `/g`
   * regex advances its own `lastIndex`, so calling it repeatedly against the
   * pieces of a split returned true and false alternately. A post with two
   * links rendered the first as a link and the second as plain text, and which
   * ones survived depended on how many pieces the split happened to produce.
   *
   * The destination is always the user's URL. Only the visible label is
   * shortened or tidied, and an address that is not http(s) is never given an
   * anchor at all.
   */
  const renderTextWithLinks = (text, keyPrefix) => {
    if (!text) return null;

    const matcher = createUrlMatcher();
    const out = [];
    let cursor = 0;
    let match;

    while ((match = matcher.exec(text)) !== null) {
      const [raw] = match;
      const { url, trailing } = splitTrailingPunctuation(raw);
      const href = resolveHref(url);

      if (match.index > cursor) {
        out.push(markMatches(text.slice(cursor, match.index), highlight, `${keyPrefix}-${cursor}`, styles.searchHit));
      }

      if (href) {
        const label = truncateUrlLabel(formatUrlForDisplay(url), urlLimit);
        out.push(
          <a
            key={`${keyPrefix}-link-${match.index}`}
            href={href}
            target="_blank"
            // `noopener` denies the opened tab a handle on this one via
            // `window.opener`; `noreferrer` keeps the referrer off the request.
            rel="noopener noreferrer nofollow ugc"
            className={styles.urlLink}
            // The whole address, for anyone who wants to see where it goes
            // before following it — the label may be shortened.
            title={url}
            onClick={(e) => e.stopPropagation()}
          >
            {label}
          </a>
        );
      } else {
        // Not a web address we will link: `javascript:`, `data:`, or simply
        // unparseable. It renders as the text the author typed, which is
        // inert — React escapes it — rather than as an anchor to "#".
        out.push(url);
      }

      if (trailing) out.push(trailing);
      cursor = match.index + raw.length;
    }

    if (cursor === 0) return markMatches(text, highlight, keyPrefix, styles.searchHit);
    if (cursor < text.length) {
      out.push(markMatches(text.slice(cursor), highlight, `${keyPrefix}-${cursor}-tail`, styles.searchHit));
    }
    return out;
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

          // Structured mentions come from the server, which already
          // validated userId/username against a live account before storing
          // them (see backend MentionsService.sanitize) — trust it directly
          // rather than gating on whatever happens to be warm in the local
          // `users` cache. That cache reflects "users this client has
          // fetched so far", not "users that exist", so requiring it here
          // made a real mention render as a dead link on a cold profile/DM
          // load and made it depend on which page the viewer opened first.
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

    return <span className={`${styles.wrapper} ${className}`}>{elements}</span>;
  }

  // 2. Fallback regex matching for legacy text without structured mentions array
  const parts = content.split(/(@[a-zA-Z0-9_.-]+)/g);
  return (
    <span className={`${styles.wrapper} ${className}`}>
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
    </span>
  );
}
