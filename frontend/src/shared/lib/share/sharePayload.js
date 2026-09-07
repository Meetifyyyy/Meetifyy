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
 * A post's share text is one fixed line naming its author, and nothing else.
 * It used to quote a teaser of the body, which republished somebody's writing
 * into a chat thread they had no part in — into WhatsApp, into a Story, into
 * wherever the link travelled next. The card and the unfurled preview are what
 * people read; the message only has to say whose post this is.
 */
import { config } from '@config';

/**
 * What this deployment calls itself.
 *
 * `VITE_APP_NAME`, same as everywhere else in the app. Typing "Meetifyy" into
 * the share text would be the one string a rename or a white-label build could
 * not reach — and it is the string that travels furthest, into other people's
 * chat threads.
 */
const APP = config.app.name;

/**
 * How much of a community's description travels in a share payload.
 *
 * A teaser, not a copy. The receiving app usually appends the URL, and every
 * platform that unfurls will replace this with the card regardless — so its
 * only real job is to be readable in the apps that do neither.
 *
 * Posts do not use this: their text is a fixed line — see `buildPostShare`.
 */
const TEASER_MAX = 140;

/** The canonical, externally shareable URL for a post. */
export function postShareUrl(postId) {
  return absoluteUrl(postId ? `/post/${postId}` : null);
}

/**
 * The rendered share card, as an image a browser can fetch and hand to another
 * application.
 *
 * SAME ORIGIN, DELIBERATELY
 * `og:image` names the API's own host, because a crawler does not care about
 * origins. This one is for JavaScript, which does: fetching it as a Blob so it
 * can be handed to the share sheet as a FILE means a cross-origin request, a
 * preflight, and a dependency on CORS staying correct. `vercel.json` rewrites
 * `/api/share/*` to the API, and Vite proxies it in development, so the
 * same-origin path reaches the same bytes with none of that.
 *
 * `story.jpg`, NOT the `image.jpg` that `og:image` names. They are different
 * pictures on purpose: the JPEG is a 1200x630 landscape thumbnail sized so
 * WhatsApp still shows a large preview, while this is a whole 1080x1920 story
 * canvas — the card on a background we drew ourselves.
 *
 * Filling the canvas exactly is the point. Handed a landscape image, Instagram
 * decides what surrounds it and offers no way to change that decision; handed
 * a story-shaped one it has nothing to decide.
 *
 * No version parameter: the endpoint ignores it, and this URL is fetched at the
 * moment of sharing rather than cached by anything that needs to be busted.
 */
export function postCardImageUrl(postId) {
  return absoluteUrl(postId ? `/api/share/post/${postId}/story.jpg` : null);
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
 * The share payload for a post.
 *
 * ONE LINE, ALWAYS THE SAME SHAPE
 * `See a post by {username} on Meetifyy` — the author, the app, nothing else.
 *
 * It used to lead with a teaser of the post's body, which read well and was
 * wrong: it copied somebody's writing into whatever thread the link was pasted
 * into, whether or not the recipient could open the post. A private post shared
 * to a person without access would have handed over its first 140 characters
 * regardless. The line below says whose post it is and no more; the destination
 * unfurls `url` into the rendered card, which is the part that is allowed to
 * show content because the server has already checked the post is public.
 *
 * `title` carries the same sentence rather than a second, longer one. The
 * platforms that use it — Reddit's prefilled submission title, and any app with
 * no link preview — would otherwise be the one place the old text survived.
 *
 * The post is accepted as any of the shapes this application passes around —
 * the feed's row, the detail route's object, the signed-out projection —
 * because the dialogs that call it are each handed a different one.
 */
export function buildPostShare(post, author) {
  const line = `See a post by ${authorName(post, author)} on ${APP}`;

  return {
    url: postShareUrl(post?.id),
    title: line,
    text: line,
    // The card as an image, for the destinations that take a picture rather
    // than a link. Only posts have one — see postCardImageUrl.
    cardImageUrl: postCardImageUrl(post?.id),
    cardFileName: `${slug(APP)}-story.jpg`,
  };
}

export function buildProfileShare(user) {
  const name = user?.displayName?.trim() || user?.username || 'Someone';
  return {
    url: profileShareUrl(user?.username),
    title: `${name} on ${APP}`,
    text: `See ${name}'s profile on ${APP}.`,
  };
}

export function buildCommunityShare(community) {
  const name = community?.name?.trim() || 'this community';
  return {
    url: communityShareUrl(community?.id),
    title: `${name} on ${APP}`,
    text: teaser(community?.description) || `Join ${name} on ${APP}.`,
  };
}

export function buildActivityShare(activity) {
  const title = activity?.title?.trim() || 'this activity';
  const when = [activity?.dateLabel || activity?.date, activity?.time]
    .filter(Boolean)
    .join(', ');

  return {
    url: activityShareUrl(activity?.id),
    title: `${title} on ${APP}`,
    text: when
      ? `${title} — ${when}. Join on ${APP}.`
      : `Join ${title} on ${APP}.`,
  };
}

/** A filename-safe form of a name. */
function slug(value) {
  return (
    String(value ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'share'
  );
}

/**
 * The handle the share line names.
 *
 * The username first, because the line says "by {username}" and a handle is
 * what somebody can search for; a display name is a fallback for the older
 * shapes that carry no username, and `someone` is the last resort — never the
 * word `undefined`, which is what an unguarded template produced.
 */
function authorName(post, author) {
  return (
    author?.username ||
    post?.author?.username ||
    author?.displayName?.trim() ||
    post?.author?.displayName?.trim() ||
    post?.authorName ||
    'someone'
  );
}

/**
 * A link written the explicit way: with a scheme, or with `www.`.
 */
const EXPLICIT_URL = /(?:https?:\/\/|www\.)\S+/gi;

/**
 * A link written the way people actually paste them — `meetifyy.app/home`, no
 * scheme. A chat app linkifies these identically, so the preview is hijacked
 * identically.
 *
 * Deliberately NOT case-insensitive on the final segment. A lowercase
 * top-level domain is what a real host has, and requiring it means `etc.Also`
 * or `sentence.Then` — a missing space after a full stop — is left alone. The
 * cost is that `node.js` in prose is treated as a host and dropped from the
 * teaser, which is rare and harmless next to sending somebody a message whose
 * preview is the wrong page.
 */
const BARE_HOST =
  /\b[a-zA-Z0-9][a-zA-Z0-9-]*(?:\.[a-zA-Z0-9-]+)*\.[a-z]{2,24}(?:\/\S*)?/g;

/**
 * A single readable line from a block of user text, or ''.
 *
 * URLS ARE REMOVED, AND THAT IS THE POINT
 * This string becomes the body of a WhatsApp message with the Meetifyy link
 * appended — and WhatsApp previews the FIRST url it finds in a message. A
 * community whose description contains a link would therefore unfurl THAT link
 * instead of the community, which defeats the feature on the platform it
 * matters most on. X has a milder version of the same problem: a url inside
 * `text` is linkified beside the one in `url`, and eats 23 characters of the
 * budget doing it.
 *
 * Nothing is lost by dropping them. A raw url is not a readable summary, and
 * the link that should be previewed is appended by the caller.
 *
 * `og:description` deliberately keeps its urls: it is a faithful description
 * rather than a message being composed, and there is nothing there for a stray
 * link to hijack.
 */
function teaser(value) {
  const text = String(value ?? '')
    .replace(EXPLICIT_URL, ' ')
    .replace(BARE_HOST, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  if (text.length <= TEASER_MAX) return text;
  const cut = text.slice(0, TEASER_MAX - 1);
  const lastSpace = cut.lastIndexOf(' ');
  const body = lastSpace > TEASER_MAX * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${body.replace(/[\s.,;:!-]+$/u, '')}…`;
}
