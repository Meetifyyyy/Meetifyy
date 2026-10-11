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

/**
 * What a person sees: "Meetifyy for Android 1.0" or "Meetifyy website". The
 * commit part of the build is left out on purpose - it means nothing to a
 * reader - but it still travels in every support report (APP_VERSION).
 */
export function appVersionLabel() {
  if (!IS_MOBILE_BUILD) return 'Meetifyy website';
  const release = APP_VERSION.split('+')[0];
  return release ? `Meetifyy for Android ${release}` : 'Meetifyy for Android';
}
