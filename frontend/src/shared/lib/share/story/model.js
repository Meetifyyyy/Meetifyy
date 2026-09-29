/**
 * What an Instagram Story card SHOWS, decided without drawing anything.
 *
 * `ShareContent` (../content.js) says what the thing is; this says what the
 * card says about it: which images make it into the collage, how many poll
 * options fit, what the member count reads as, which tags survive. The
 * renderer (./renderer.js) then only has to place what it is given. Keeping
 * the decisions here makes them testable without a canvas, and keeps the
 * renderer free of content rules.
 */
import { getDefaultActivityCover } from '@shared/utils/activityCover';
import { SHARE_KIND } from '../content';

/** The card is drawn at this width; Instagram scales the sticker freely. */
export const STORY_CARD_WIDTH = 1000;

/**
 * The Story background behind the sticker. Instagram draws a vertical
 * gradient between these; they are also what the in-app preview paints, so
 * the two match.
 */
export const STORY_BACKGROUND = { top: '#1D4ED8', bottom: '#0F172A' };

/** Most images a post collage shows; the rest are counted as "+N". */
const MAX_COLLAGE_IMAGES = 4;
/** Most poll options drawn; the rest are summarised in one line. */
const MAX_POLL_OPTIONS = 4;
/** Most profile tags offered to the renderer, which may fit fewer. */
const MAX_TAGS = 12;

/** "12", "1.2K", "12.4K", "3.1M" — the same scale the chat preview uses. */
export function compactCount(n) {
  const count = typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
  if (count >= 1_000_000) return `${trimZero((count / 1_000_000).toFixed(1))}M`;
  if (count >= 1_000) return `${trimZero((count / 1_000).toFixed(1))}K`;
  return String(count);
}

/** "1 like", "24 likes", "1.5K likes". */
export function countLabel(n, one, many) {
  return `${compactCount(n)} ${n === 1 ? one : many}`;
}

const trimZero = (s) => s.replace(/\.0$/, '');

/**
 * The collage arrangement for N images:
 *   1 → single (aspect-preserving within limits)
 *   2 → pair (side by side)
 *   3 → feature (one tall left, two stacked right)
 *   4+ → grid (2×2, the last tile carrying "+N" when there are more)
 */
export function collageFor(images) {
  const shown = images.slice(0, MAX_COLLAGE_IMAGES);
  const layout =
    shown.length === 0 ? null
      : shown.length === 1 ? 'single'
        : shown.length === 2 ? 'pair'
          : shown.length === 3 ? 'feature'
            : 'grid';
  return { layout, images: shown, more: Math.max(0, images.length - shown.length) };
}

function pollModel(poll) {
  if (!poll) return null;
  const total = poll.totalVotes;
  const options = poll.options.slice(0, MAX_POLL_OPTIONS).map((o) => ({
    text: o.text,
    // Results only when somebody has voted; otherwise a row of 0% bars reads
    // as a poll nobody cared about.
    pct: total > 0 ? Math.round((o.votes / total) * 100) : null,
  }));
  const leader = total > 0 ? Math.max(...poll.options.map((o) => o.votes)) : -1;
  poll.options.slice(0, MAX_POLL_OPTIONS).forEach((o, i) => {
    options[i].leading = total > 0 && o.votes === leader;
  });
  return {
    // Only when it says something the post text does not already say.
    question: poll.question && poll.question !== 'Poll' ? poll.question : '',
    options,
    hiddenOptions: Math.max(0, poll.options.length - MAX_POLL_OPTIONS),
    votesLabel: `${compactCount(total)} ${total === 1 ? 'vote' : 'votes'}`,
  };
}

/**
 * `ShareContent` → the card model the renderer draws.
 *
 * Every card has `kind`, `image` URLs to preload (`imageUrls`), and the
 * kind-specific fields below. Nothing here is a pixel value except the width.
 */
export function buildStoryModel(content) {
  if (!content) return null;
  const base = { kind: content.kind, url: content.url, width: STORY_CARD_WIDTH };

  switch (content.kind) {
    case SHARE_KIND.POST: {
      const collage = collageFor(content.images);
      const poll = pollModel(content.poll);
      const text = content.text.replace(/\n{3,}/g, '\n\n').trim();
      return {
        ...base,
        author: content.author,
        text,
        collage,
        poll,
        // The footer carries the post's reactions, not its age: a story is
        // seen for a day, and "3h ago" would be wrong within the hour.
        stats: [
          countLabel(content.likeCount, 'like', 'likes'),
          countLabel(content.commentCount, 'comment', 'comments'),
        ].join(' · '),
        imageUrls: [content.author.avatar, ...collage.images].filter(Boolean),
      };
    }
    case SHARE_KIND.PROFILE:
      return {
        ...base,
        name: content.name,
        subtitle: content.username ? `@${content.username}` : '',
        avatar: content.avatar,
        cover: content.cover,
        tags: content.tags.slice(0, MAX_TAGS),
        imageUrls: [content.avatar, content.cover.type === 'image' ? content.cover.url : ''].filter(Boolean),
      };
    case SHARE_KIND.COMMUNITY:
      return {
        ...base,
        name: content.name,
        subtitle: `${compactCount(content.memberCount)} ${content.memberCount === 1 ? 'member' : 'members'}`,
        avatar: content.avatar,
        avatarColor: content.color,
        cover: content.cover,
        tags: [],
        imageUrls: [content.avatar, content.cover.type === 'image' ? content.cover.url : ''].filter(Boolean),
      };
    case SHARE_KIND.ACTIVITY:
      return {
        ...base,
        ...activityLabels(content),
        // The same deterministic fallback the chat card shows.
        image: content.image || getDefaultActivityCover(content.id || content.title || ''),
        imageUrls: [content.image || getDefaultActivityCover(content.id || content.title || '')],
      };
    default:
      return null;
  }
}

/**
 * The activity card's text, exactly as the chat preview card
 * (`ActivityPreviewCard`) words it: a calendar tile, the title, "Mon D • time"
 * and the location.
 */
export function activityLabels(content) {
  const date = content.startDate ? new Date(content.startDate) : null;
  const valid = date && !Number.isNaN(date.getTime());
  const dayLabel =
    content.dateLabel ||
    (valid ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');
  return {
    title: content.title,
    meta: [dayLabel, content.time || 'TBD'].filter(Boolean).join(' • '),
    location: content.location,
    calendar: calendarLabels(valid ? date : null, content.dateLabel),
  };
}

/**
 * Month and day for the calendar tile, resolved the way `CalendarIcon` does:
 * the date, else whatever a free-text label says ("Mar 14"), else today.
 */
function calendarLabels(date, dateLabel) {
  const monthMatch = /\b([A-Za-z]{3})[A-Za-z]*\b/.exec(dateLabel || '');
  const dayMatch = /\b(\d{1,2})\b/.exec(dateLabel || '');
  const today = new Date();
  return {
    month: date
      ? date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()
      : (monthMatch?.[1] || today.toLocaleDateString('en-US', { month: 'short' })).toUpperCase(),
    day: date ? String(date.getDate()) : dayMatch?.[1] || String(today.getDate()),
  };
}
