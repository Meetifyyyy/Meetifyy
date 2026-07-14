/**
 * Classifies a URL as an internal Meetifyy route or an external link.
 *
 * Returns one of:
 *   { type: 'post',      id: '...' }
 *   { type: 'profile',   username: '...' }
 *   { type: 'community', slug: '...' }
 *   { type: 'external',  url: '...' }
 *   { type: 'unknown',   url: '...' }   ← internal but unrecognized route
 */
export function classifyMeetifyyURL(url) {
  try {
    const parsed = new URL(url);

    // Update these to match the actual deployed domains
    const MEETIFYY_DOMAINS = [
      'meetifyy.com',
      'www.meetifyy.com',
      'app.meetifyy.com',
      'localhost',           // for local dev
      '127.0.0.1'
    ];

    const isInternal = MEETIFYY_DOMAINS.some(
      domain => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`)
    );

    if (!isInternal) {
      return { type: 'external', url };
    }

    const path = parsed.pathname;

    // ── POST routes ──────────────────────────────────────────
    const postMatch =
      path.match(/^\/post\/([^/]+)$/) ||
      path.match(/^\/p\/([^/]+)$/) ||
      path.match(/^\/feed\/([^/]+)$/);

    if (postMatch) return { type: 'post', id: postMatch[1] };

    // ── PROFILE routes ────────────────────────────────────────
    const profileMatch =
      path.match(/^\/profile\/([^/]+)$/) ||
      path.match(/^\/u\/([^/]+)$/);

    if (profileMatch) return { type: 'profile', username: profileMatch[1] };

    // ── COMMUNITY routes ──────────────────────────────────────
    const communityMatch =
      path.match(/^\/communities\/([^/]+)$/) ||
      path.match(/^\/c\/([^/]+)$/);

    if (communityMatch) return { type: 'community', slug: communityMatch[1] };

    // ── ACTIVITY (CREW) routes ────────────────────────────────
    const activityMatch =
      path.match(/^\/crew\/([^/]+)$/) ||
      path.match(/^\/activity\/([^/]+)$/);

    if (activityMatch) return { type: 'activity', id: activityMatch[1] };

    // Internal URL but no recognized route pattern
    return { type: 'unknown', url };

  } catch {
    // URL parsing failed — not a valid URL
    return { type: 'unknown', url };
  }
}
