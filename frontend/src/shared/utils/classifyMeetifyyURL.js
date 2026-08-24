/**
 * Classifies a URL as an internal app route or an external link.
 *
 * Which hostnames count as "internal" is configuration (VITE_INTERNAL_DOMAINS
 * plus the current origin), not a list baked into the source.
 *
 * Returns one of:
 *   { type: 'post',      id: '...' }
 *   { type: 'profile',   username: '...' }
 *   { type: 'community', slug: '...' }
 *   { type: 'external',  url: '...' }
 *   { type: 'unknown',   url: '...' }   ← internal but unrecognized route
 */
import { config } from '@config';

export function classifyMeetifyyURL(url) {
  try {
    const parsed = new URL(url);

    // The app's own origin always counts as internal; VITE_INTERNAL_DOMAINS
    // covers its other domains (apex, www, app subdomain, preview hosts) so a
    // new deployment domain never requires editing this file.
    const internalDomains = config.app.internalDomains;

    const isIP = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(parsed.hostname);
    const currentHost = typeof window !== 'undefined' ? window.location.hostname : '';

    const isInternal = isIP || parsed.hostname === currentHost || internalDomains.some(
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
