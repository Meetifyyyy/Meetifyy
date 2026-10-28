import { useNavigate } from 'react-router-dom';

import {
  createUrlMatcher,
  formatUrlForDisplay,
  resolveHref,
  splitTrailingPunctuation,
  truncateUrlLabel,
} from '@shared/utils/postLinks';
import { hashtagSearchPath, splitHashtags } from '@shared/utils/hashtags';
import styles from './RichText.module.css';
import { useUsersMap } from '@shared/hooks/useUsersMap';
import { inAppPathFor, isModifiedClick } from '@shared/utils/inAppLink';


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

/**
 * @param {boolean} [verifiedMentionsOnly] Style only the @handles in
 *   `mentions` (which the server verified when the text was saved), matched by
 *   name wherever they appear. For messages: their text can be normalised
 *   before display, which moves the stored offsets, and anything that merely
 *   looks like a handle must stay plain text.
 * @param {string} [linkClassName] Added to every link, for surfaces with their
 *   own link treatment (a chat bubble's colour depends on whose it is).
 * @param {string} [mentionClassName] Added to every @mention, likewise.
 */
const isEveryone = (username) => String(username || '').toLowerCase() === 'everyone';

export default function RichText({ content = '', mentions = [], className = '', urlLimit = 50, highlight = '', linkHashtags = false, verifiedMentionsOnly = false, linkClassName = '', mentionClassName = '' }) {
  const navigate = useNavigate();
  // useUsersMap() always returns an object, so the `= {}` default is no longer needed.
  const users = useUsersMap();

  if (!content) return null;

  const verifiedNames = verifiedMentionsOnly
    ? new Set((Array.isArray(mentions) ? mentions : [])
      .map((m) => String(m?.username || '').toLowerCase())
      .filter(Boolean))
    : null;

  // Helper to check if username exists in known users
  const isValidUser = (username) => {
    if (!username) return false;
    const clean = username.toLowerCase();
    if (verifiedNames) return verifiedNames.has(clean);
    return Object.keys(users).some(k => k.toLowerCase() === clean || (users[k].username && users[k].username.toLowerCase() === clean));
  };
  const mentionClass = `${styles.mentionLink}${mentionClassName ? ` ${mentionClassName}` : ''}`;

  const handleMentionClick = (e, username) => {
    e.stopPropagation();
    if (username && !isEveryone(username)) {
      navigate(`/profile/${username}`);
    }
  };
  // `@everyone` (group chats) tags the whole group: styled like any mention,
  // but it is not a person and has no profile to open.
  const mentionTitle = (username) => (isEveryone(username) ? 'Everyone in this group' : `Go to @${username}'s profile`);

  /**
   * Plain text, with search hits marked and — where `linkHashtags` is on —
   * each #hashtag turned into a link to the posts carrying it. Runs only on
   * text outside URLs, so a URL's `#fragment` stays part of the URL.
   */
  const renderPlain = (text, keyPrefix) => {
    if (!linkHashtags) return markMatches(text, highlight, keyPrefix, styles.searchHit);
    const parts = splitHashtags(text);
    if (parts.length === 1 && !parts[0].tag) {
      return markMatches(text, highlight, keyPrefix, styles.searchHit);
    }
    return parts.map((part, i) =>
      part.tag ? (
        <span
          key={`${keyPrefix}-tag-${i}`}
          className={styles.hashtagLink}
          role="link"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            navigate(hashtagSearchPath(part.tag));
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.stopPropagation();
              navigate(hashtagSearchPath(part.tag));
            }
          }}
        >
          {markMatches(part.text, highlight, `${keyPrefix}-tag-${i}`, styles.searchHit)}
        </span>
      ) : (
        markMatches(part.text, highlight, `${keyPrefix}-txt-${i}`, styles.searchHit)
      )
    );
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
  const renderTextWithLinks = (text, keyPrefix, renderRun = renderPlain) => {
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
        out.push(renderRun(text.slice(cursor, match.index), `${keyPrefix}-${cursor}`));
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
            className={`${styles.urlLink}${linkClassName ? ` ${linkClassName}` : ''}`}
            // The whole address, for anyone who wants to see where it goes
            // before following it — the label may be shortened.
            title={url}
            onClick={(e) => {
              e.stopPropagation();
              // A link to one of this site's own pages (a group invite, a
              // post, a profile) opens it here rather than leaving the app.
              if (e.defaultPrevented || isModifiedClick(e)) return;
              const inApp = inAppPathFor(href);
              if (inApp) {
                e.preventDefault();
                navigate(inApp);
              }
            }}
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

    if (cursor === 0) return renderRun(text, keyPrefix);
    if (cursor < text.length) {
      out.push(renderRun(text.slice(cursor), `${keyPrefix}-${cursor}-tail`));
    }
    return out;
  };


  // 1. If structured mentions exist, slice by exact indices
  if (!verifiedNames && Array.isArray(mentions) && mentions.length > 0) {
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
              className={mentionClass}
              onClick={(e) => handleMentionClick(e, m.username)}
              title={mentionTitle(m.username)}
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

  // 2. Matched by name: legacy text without a structured mentions array, and
  // messages (verifiedMentionsOnly).
  //
  // Links are found first and mentions only in the text between them. The
  // other way round, a link with an "@" in it (medium.com/@ana) was cut in two
  // at the "@", and the rest of the address styled as a mention. A handle also
  // needs something other than a word character before its "@", so an email
  // address (bob@ana.dev) is never read as a mention of "ana".
  const renderMentions = (text, keyPrefix) => {
    const parts = text.split(/(@[a-zA-Z0-9_.-]+)/g);
    if (parts.length === 1) return renderPlain(text, keyPrefix);
    return parts.map((part, idx) => {
      const before = idx > 0 ? parts[idx - 1] : '';
      if (part.startsWith('@') && part.length > 1 && !/[A-Za-z0-9_]$/.test(before)) {
        // "@ana." at the end of a sentence: the handle is "ana", the dot is prose.
        const handle = part.slice(1);
        const trimmed = handle.replace(/[.-]+$/, '');
        const username = isValidUser(handle) ? handle : (trimmed && isValidUser(trimmed) ? trimmed : null);
        if (username) {
          return (
            <span key={`${keyPrefix}-m-${idx}`}>
              <span
                className={mentionClass}
                onClick={(e) => handleMentionClick(e, username)}
                title={mentionTitle(username)}
              >
                @{username}
              </span>
              {handle.slice(username.length)}
            </span>
          );
        }
      }
      return part ? (
        <span key={`${keyPrefix}-t-${idx}`} className={styles.plainText}>
          {renderPlain(part, `${keyPrefix}-t-${idx}`)}
        </span>
      ) : null;
    });
  };

  return (
    <span className={`${styles.wrapper} ${className}`}>
      {renderTextWithLinks(content, 'rt', renderMentions)}
    </span>
  );
}
