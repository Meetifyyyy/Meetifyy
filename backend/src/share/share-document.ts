import { config } from '../config';
import {
  SharePreviewService,
  type PublicSharePost,
} from './share-preview.service';

/**
 * Builds the document a social crawler reads when it follows a Meetifyy post
 * link, and the metadata that goes in it.
 *
 * WHY A SERVER-RENDERED DOCUMENT EXISTS AT ALL
 * The site is a client-rendered SPA. `frontend/scripts/prerender-seo.mjs`
 * already solves this for the seven static public pages by writing one physical
 * HTML file per route at build time — but a post is not knowable at build time,
 * and there are unboundedly many of them. facebookexternalhit, WhatsApp,
 * Discord, Telegram, Twitterbot, LinkedInBot and Slackbot all fetch the
 * document and parse `<head>` without executing a single line of script, so
 * `og:` tags written by React are invisible to every one of them.
 *
 * The edge sends only those crawlers here (see the user-agent condition on the
 * `/post/:id` rewrite in vercel.json). A person continues to be served
 * `app.html` exactly as before, so nothing about normal page loading changes.
 *
 * THE DOCUMENT CARRIES NO SCRIPT AND NO STYLE OF CONSEQUENCE
 * It exists to be parsed, not rendered. The redirect is a `<meta http-equiv>`
 * plus a real link, so a person who reaches it — a spoofed user agent, a
 * crawler that shares its cache with a browser — still lands on the post rather
 * than on a blank page, without needing JavaScript to get there.
 */

/**
 * Whether a post preview invites search indexing.
 *
 * `false`, deliberately. Every authenticated app route is `noindex` today (see
 * `buildPageSeo`, and the fact that `app.html` rather than `index.html` is the
 * SPA fallback), and posts are user content that authors expect to be findable
 * in Meetifyy rather than in Google. Unfurlers do not consult robots directives
 * — WhatsApp, Discord and Telegram will render the card regardless — so this
 * costs nothing that link sharing depends on.
 *
 * Flipping it to `true` opens every public post to search engines. That is a
 * product decision with privacy consequences, not a configuration detail, which
 * is why it is one obvious constant rather than an environment variable that
 * could differ between deployments without anyone noticing.
 */
export const SHARE_PREVIEWS_ARE_INDEXABLE = false;

export interface ShareMetadata {
  canonicalUrl: string;
  imageUrl: string;
  title: string;
  description: string;
  siteName: string;
}

/** The canonical, externally shareable URL for a post. One shape, one place. */
export function canonicalPostUrl(postId: string): string {
  return `${trimSlash(config.app.frontendUrl)}/post/${postId}`;
}

/**
 * The OG image URL for a post.
 *
 * Served from the FRONTEND origin rather than the API's, even though the API is
 * what renders it. `vercel.json` rewrites `/api/share/*` to the API, so the
 * bytes come from the same place either way — but going through the frontend
 * host puts Vercel's CDN in front of the one genuinely expensive operation in
 * this feature, and gives the card a URL on the same origin as the page that
 * references it, which a couple of unfurlers are happier about.
 *
 * The path is stable and the version rides in the query string. That is what
 * lets the response be `immutable` for a year while an edited post still
 * previews correctly: editing the post moves `updatedAt`, the crawler is handed
 * a different URL on its next fetch, and no cache anywhere has to be purged.
 */
export function shareImageUrl(post: PublicSharePost): string {
  const version = SharePreviewService.versionToken(post);
  return `${trimSlash(config.app.frontendUrl)}/api/share/post/${post.id}/image.jpg?v=${version}`;
}

export function buildShareMetadata(post: PublicSharePost): ShareMetadata {
  const siteName = config.app.name;
  return {
    canonicalUrl: canonicalPostUrl(post.id),
    imageUrl: shareImageUrl(post),
    title: SharePreviewService.title(post, siteName),
    description: SharePreviewService.description(post),
    siteName,
  };
}

/** The crawler-facing HTML document for a public post. */
export function renderShareDocument(post: PublicSharePost): string {
  const meta = buildShareMetadata(post);
  const robots = SHARE_PREVIEWS_ARE_INDEXABLE
    ? 'index, follow, max-image-preview:large'
    : 'noindex, follow';

  const tags = [
    `<title>${escapeHtml(meta.title)}</title>`,
    `<meta name="description" content="${escapeHtml(meta.description)}" />`,
    `<meta name="robots" content="${escapeHtml(robots)}" />`,
    `<link rel="canonical" href="${escapeHtml(meta.canonicalUrl)}" />`,

    `<meta property="og:type" content="article" />`,
    `<meta property="og:site_name" content="${escapeHtml(meta.siteName)}" />`,
    `<meta property="og:title" content="${escapeHtml(meta.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(meta.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(meta.canonicalUrl)}" />`,
    `<meta property="og:image" content="${escapeHtml(meta.imageUrl)}" />`,
    // Declared dimensions let Facebook and LinkedIn lay the card out before the
    // image itself has finished downloading, which is the difference between a
    // large card and a small one on the first share of a URL.
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:type" content="image/jpeg" />`,
    `<meta property="og:image:alt" content="${escapeHtml(`${post.author.displayName} on ${meta.siteName}`)}" />`,
    `<meta property="og:locale" content="en_US" />`,
    `<meta property="article:published_time" content="${escapeHtml(post.createdAt.toISOString())}" />`,

    ...videoTags(post),

    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(meta.title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(meta.description)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(meta.imageUrl)}" />`,
    `<meta name="twitter:image:alt" content="${escapeHtml(`${post.author.displayName} on ${meta.siteName}`)}" />`,
  ];

  return document(meta.canonicalUrl, tags, meta.title);
}

/**
 * The document served for a post that is not publicly shareable.
 *
 * Deleted, private, restricted, suspended author, or simply not a post — all
 * one response, carrying no post data of any kind and no `og:` tags beyond the
 * site's own. Distinguishing between them here would turn the endpoint into a
 * way to ask "does this private post exist", which is the question it must not
 * answer.
 */
export function renderUnavailableDocument(): string {
  const siteName = config.app.name;
  const home = trimSlash(config.app.frontendUrl);
  const title = `Post unavailable | ${siteName}`;

  const tags = [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml('This post is no longer available.')}" />`,
    `<meta name="robots" content="noindex, nofollow" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${escapeHtml(siteName)}" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml('This post is no longer available.')}" />`,
    `<meta property="og:url" content="${escapeHtml(home)}" />`,
    `<meta name="twitter:card" content="summary" />`,
  ];

  return document(home, tags, title);
}

/**
 * `og:video` for a post that carries one.
 *
 * WHAT THIS DOES AND DOES NOT CLAIM
 * `og:type` stays `article`. Declaring `video.other` asks Facebook and X to
 * render an inline player instead of the card, and an unfurler that decides it
 * cannot play the file falls back to a smaller, worse preview than the one the
 * image card already gives. The video tags are additive: platforms that use
 * them get the file, and every platform that does not ignores them and shows
 * the card. That is the conservative half of "use the correct video metadata
 * where supported".
 *
 * `og:image` is untouched and still names the rendered card, because that is
 * what actually appears in a chat thread.
 */
function videoTags(post: PublicSharePost): string[] {
  if (!post.video) return [];

  const tags = [
    `<meta property="og:video" content="${escapeHtml(post.video.url)}" />`,
    `<meta property="og:video:secure_url" content="${escapeHtml(post.video.url)}" />`,
    `<meta property="og:video:type" content="${escapeHtml(post.video.mimeType)}" />`,
  ];

  // Only when the database actually knows them. A guessed dimension is worse
  // than an absent one: a player sized to the wrong aspect ratio letterboxes
  // the video for everyone.
  if (post.video.width && post.video.height) {
    tags.push(
      `<meta property="og:video:width" content="${post.video.width}" />`,
      `<meta property="og:video:height" content="${post.video.height}" />`,
    );
  }

  return tags;
}

function document(target: string, tags: string[], heading: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
${tags.map((tag) => `  ${tag}`).join('\n')}
  <meta http-equiv="refresh" content="0; url=${escapeHtml(target)}" />
</head>
<body>
  <p>${escapeHtml(heading)}</p>
  <p><a href="${escapeHtml(target)}">Continue to ${escapeHtml(config.app.name)}</a></p>
</body>
</html>
`;
}

/**
 * Escapes a value for HTML — one function for both attributes and text nodes.
 *
 * Every value passing through here is user-controlled: a display name, a
 * username, post text. Unescaped, a display name containing a double quote ends
 * the attribute it sits in and the rest of the name becomes markup in the
 * document a crawler parses.
 *
 * Deliberately NOT split into an attribute escaper and a looser text escaper.
 * Quotes are harmless in a text node, so a text-only variant would be correct —
 * right up until someone moves a value from a `<title>` into a `content="..."`
 * and takes the wrong helper with it. One function that is always safe removes
 * that decision from every call site.
 */
function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function trimSlash(value: string): string {
  return String(value ?? '').replace(/\/+$/, '');
}
