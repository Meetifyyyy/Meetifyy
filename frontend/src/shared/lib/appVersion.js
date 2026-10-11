/**
 * The running client and build, for support reports and the Help footer.
 *
 * Both values are stamped at build time: `__MEETIFYY_APP_VERSION__` by the
 * mobile build (`<versionName>+<commit>`), `__MEETIFYY_SENTRY_RELEASE__` by the
 * web build (`meetifyy-web@<commit>`). Each is defined in one build only, so
 * they are read behind `typeof` and an unstamped build (tests, local dev
 * without git) yields an empty version rather than throwing.
 */
import { IS_MOBILE_BUILD } from '@config';

export const APP_PLATFORM = IS_MOBILE_BUILD ? 'android' : 'web';

function stampedVersion() {
  if (IS_MOBILE_BUILD) {
    return typeof __MEETIFYY_APP_VERSION__ === 'string' ? __MEETIFYY_APP_VERSION__ : '';
  }
  const release = typeof __MEETIFYY_SENTRY_RELEASE__ === 'string' ? __MEETIFYY_SENTRY_RELEASE__ : '';
  const commit = release.split('@')[1] || '';
  return commit.slice(0, 12);
}

export const APP_VERSION = stampedVersion();

/** "Android app 1.0+1a2b3c4d5e6f", "Website build 1a2b3c4d5e6f", or "Website". */
export function appVersionLabel() {
  const name = IS_MOBILE_BUILD ? 'Android app' : 'Website';
  if (!APP_VERSION) return name;
  return IS_MOBILE_BUILD ? `${name} ${APP_VERSION}` : `${name} build ${APP_VERSION}`;
}
