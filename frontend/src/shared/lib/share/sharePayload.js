/**
 * What gets shared, for every kind of thing Meetifyy lets you share.
 *
 * ONE PLACE THAT KNOWS THE URLS
 * The canonical link is not a cosmetic detail: `/post/:id` is the URL the
 * server generates Open Graph metadata for, the URL a crawler is served a card
 * at, and the URL the canonical tag names. Four dialogs each built their own
 * before this, and one of them was wrong — the activity dialog copied
 * `/activity/:id`, which this application has never routed. Every link now
 * comes from here, and the route table below is checked against the router by
 * `config/__tests__/publicPostAccess.test.js`.
 *
 * ONE PLACE THAT KNOWS THE COPY
 * The share text has to describe a post without republishing it. A poll leads
 * with its question, a gallery says how many photographs there are, a video
 * says it is a video — and none of them carries more of the body than a teaser,
 * because the platforms truncate it anyway and the card is what people read.
 */

/**
 * How much post text travels in a share payload.
 *
 * A teaser, not a copy. The receiving app usually appends the URL, and every
 * platform that unfurls will replace this with the card regardless — so its
 * only real job is to be readable in the apps that do neither.
 */
const TEASER_MAX = 140;

/** The canonical, externally shareable URL for a post. */
export function postShareUrl(postId) {
  return absoluteUrl(postId ? `/post/${postId}` : null);
}

/** The canonical URL for a profile. */
export function profileShareUrl(username) {
  return absoluteUrl(username ? `/profile/${username}` : null);
}

/** The canonical URL for a community. */
export function communityShareUrl(communityId) {
  return absoluteUrl(communityId ? `/communities/${communityId}` : null);
}

/**
 * The canonical URL for a crew activity.
 *
 * `/crew/:id`, which is the route the application actually has. The share
 * dialog used to copy `/activity/:id` — a path with no route behind it — so
 * every activity link anyone shared led to Not Found.
 */
export function activityShareUrl(activityId) {
  return absoluteUrl(activityId ? `/crew/${activityId}` : null);
}

/**
 * Built from the current origin rather than a configured site URL, on purpose:
 * a link copied on dev.meetifyy.app must open dev, and one copied on localhost
 * must open localhost. In production the origin IS the canonical host, so the
 * case that matters is correct with no environment branching.
 */
function absoluteUrl(path) {
  if (!path) return '';
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return `${origin}${path}`;
}

/**
 * The share payload for a post, shaped by what the post actually is.
 *
 * Accepts the post as any of the shapes this application passes around — the
 * feed's row, the detail route's object, the signed-out projection — because
 * the four dialogs that call it are each handed a different one. Everything is
 * read defensively for that reason, and nothing here assumes a field exists.
 */
export function buildPostShare(post, author) {
  const name = authorName(post, author);
  const body = teaser(post?.text);
  const kind = describePost(post);

  return {
    url: postShareUrl(post?.id),
    // The title is what a platform without link previews shows, and what
    // Reddit prefills its submission with. It has to stand on its own.
    title: body ? `${name} on Meetifyy: ${body}` : `${name} shared ${kind} on Meetifyy`,
    text: body || `See ${kind} by ${name} on Meetifyy.`,
  };
}

export function buildProfileShare(user) {
  const name = user?.displayName?.trim() || user?.username || 'Someone';
  return {
    url: profileShareUrl(user?.username),
    title: `${name} on Meetifyy`,
    text: `See ${name}'s profile on Meetifyy.`,
  };
}

export function buildCommunityShare(community) {
  const name = community?.name?.trim() || 'this community';
  return {
    url: communityShareUrl(community?.id),
    title: `${name} on Meetifyy`,
    text: teaser(community?.description) || `Join ${name} on Meetifyy.`,
  };
}

export function buildActivityShare(activity) {
  const title = activity?.title?.trim() || 'this activity';
  const when = [activity?.dateLabel || activity?.date, activity?.time]
    .filter(Boolean)
    .join(', ');

  return {
    url: activityShareUrl(activity?.id),
    title: `${title} on Meetifyy`,
    text: when ? `${title} — ${when}. Join on Meetifyy.` : `Join ${title} on Meetifyy.`,
  };
}

/**
 * What the post is, in words.
 *
 * Mirrors `SharePreviewService.noun` on the server so the text a person sends
 * and the title a crawler reads describe the same thing. They are two languages
 * and cannot literally share the function, so the ordering is kept identical
 * and each is tested against the same cases.
 */
export function describePost(post) {
  if (isPoll(post)) return 'a poll';

  const { images, videos } = countMedia(post);
  if (videos > 0 && images > 0) return 'a video and photos';
  if (videos > 1) return `${videos} videos`;
  if (videos === 1) return 'a video';
  if (images > 1) return `${images} photos`;
  if (images === 1) return 'a photo';
  return 'a post';
}

/**
 * Counts the post's media, tolerating every shape this application uses.
 *
 * The feed hands over `media: [{ mimeType, type, url }]`; the signed-out
 * projection hands over `imageCount`/`videoCount` already counted; older call
 * sites pass `images` or a single `mediaUrl`. Reading whichever is present
 * beats making four dialogs normalise it four ways.
 *
 * Derived thumbnails are excluded by key, exactly as the server does: a post
 * attachment is stored as two Media rows, and counting both reports a gallery
 * of three as six.
 */
export function countMedia(post) {
  if (typeof post?.imageCount === 'number' || typeof post?.videoCount === 'number') {
    return {
      images: post.imageCount ?? 0,
      videos: post.videoCount ?? 0,
    };
  }

  const list = Array.isArray(post?.media)
    ? post.media
    : Array.isArray(post?.images)
      ? post.images
      : [];

  let images = 0;
  let videos = 0;

  for (const item of list) {
    const key = String(
      (typeof item === 'string' ? item : item?.objectKey || item?.url || '') ?? '',
    );
    if (/_thumb\.[a-z0-9]+$/i.test(key)) continue;

    const mime = String(item?.mimeType ?? '');
    const type = String(item?.type ?? '').toLowerCase();
    if (/^video\//i.test(mime) || type === 'video' || /\.(mp4|webm|mov|ogv)$/i.test(key)) {
      videos += 1;
    } else {
      images += 1;
    }
  }

  // The oldest shape: one image on the post itself, no array at all.
  if (images === 0 && videos === 0 && (post?.mediaUrl || post?.image)) images = 1;

  return { images, videos };
}

/** Whether the post carries a poll, in any of the shapes the app uses. */
export function isPoll(post) {
  if (post?.isPoll === true) return true;
  if (post?.poll && typeof post.poll === 'object') return true;
  return Array.isArray(post?.pollOptions) && post.pollOptions.length > 0;
}

function authorName(post, author) {
  return (
    author?.displayName?.trim() ||
    author?.username ||
    post?.author?.displayName?.trim() ||
    post?.author?.username ||
    post?.authorName ||
    'Someone'
  );
}

/** A single readable line from a block of user text, or ''. */
function teaser(value) {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  if (text.length <= TEASER_MAX) return text;
  const cut = text.slice(0, TEASER_MAX - 1);
  const lastSpace = cut.lastIndexOf(' ');
  const body = lastSpace > TEASER_MAX * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${body.replace(/[\s.,;:!-]+$/u, '')}…`;
}
