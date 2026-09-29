import { config, IS_MOBILE_BUILD } from '@config';

/**
 * The origin a link that LEAVES the app should be built on.
 *
 * In a browser that is the page's own origin, so a link copied on
 * dev.meetifyy.app opens dev and one copied on localhost opens localhost. The
 * installed app is different: its page origin is the WebView's own
 * `https://localhost` (or a dev server's), which nobody else can open, so every
 * link it shared — a post, an activity, a conversation — pointed at nothing.
 * There it is the configured site URL (`VITE_SITE_URL`), which is the deployment
 * the app talks to: dev.meetifyy.app for the development build, meetifyy.app for
 * production.
 *
 * `IS_MOBILE_BUILD` is the build-time literal, so the website's bundle keeps
 * exactly the behaviour it had.
 */
export function publicOrigin() {
  if (IS_MOBILE_BUILD && config.app.siteUrl) return config.app.siteUrl.replace(/\/+$/, '');
  return typeof window === 'undefined' ? '' : window.location.origin;
}
