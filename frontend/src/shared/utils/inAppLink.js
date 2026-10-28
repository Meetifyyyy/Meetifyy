import { config } from '@config';
import { parseIntentFromPath } from '../../core/navigation/intents';

/**
 * The in-app path for a link to Meetifyy itself, or null for anything else.
 *
 * A link in a message or post was always opened as an external page. In the
 * installed app that meant Capacitor handing it to the browser (it opens every
 * URL that is not the app's own origin with an ACTION_VIEW intent), so tapping
 * a group invite inside a chat left the app for the website, and the person
 * had to find their way back. A link to this site's own pages is navigation,
 * not a new page: it is routed inside the app instead.
 *
 * Only this deployment's own origin (the site URL, or the page's origin on the
 * website) and only a destination the router knows (the same table deep links
 * and push taps go through) are routed; everything else opens as before.
 */
export function inAppPathFor(href, {
  siteUrl = config.app.siteUrl,
  pageOrigin = typeof window === 'undefined' ? '' : window.location.origin,
} = {}) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const own = new Set();
  [siteUrl, pageOrigin].forEach((origin) => {
    try {
      if (origin) own.add(new URL(origin).origin);
    } catch {
      // Not a URL: contributes nothing.
    }
  });
  if (!own.has(url.origin)) return null;
  if (!parseIntentFromPath(url.pathname)) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** True for a click that asked for a new tab or window (the browser's to handle). */
export function isModifiedClick(event) {
  return Boolean(
    event?.metaKey || event?.ctrlKey || event?.shiftKey || event?.altKey || (event?.button ?? 0) !== 0,
  );
}
