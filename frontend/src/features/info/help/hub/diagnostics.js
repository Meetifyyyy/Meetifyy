/**
 * Device and build details attached to every support request, so the user
 * never has to look them up and the team can reproduce what they saw.
 *
 * Everything here is a convenience for whoever triages the ticket. The server
 * treats each field as untrusted display text and records the real user agent
 * from the request header itself; nothing identifies the user beyond what the
 * browser already sends.
 */
import { APP_PLATFORM, APP_VERSION, appVersionLabel } from '@shared/lib/appVersion';

function browserName(ua) {
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\//.test(ua)) return 'Opera';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Unknown';
}

function osName(ua) {
  if (/Windows/.test(ua)) return 'Windows';
  if (/Android/.test(ua)) return 'Android';
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
  if (/Mac OS X/.test(ua)) return 'macOS';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Unknown';
}

/** Shape matches `SupportBrowserInfoDto` on the API. */
export function collectDiagnostics() {
  if (typeof navigator === 'undefined') return { platform: APP_PLATFORM };
  const ua = navigator.userAgent || '';
  return {
    browser: browserName(ua),
    os: osName(ua),
    deviceType: /Mobi|Android/i.test(ua) ? 'mobile' : 'desktop',
    screen: typeof window !== 'undefined' ? `${window.screen?.width}x${window.screen?.height}` : undefined,
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    platform: APP_PLATFORM,
    ...(APP_VERSION ? { appVersion: APP_VERSION } : {}),
  };
}

/** "en-US" -> "English (United States)"; the code itself if the browser cannot name it. */
function languageName(code) {
  try {
    return new Intl.DisplayNames([code], { type: 'language' }).of(code) || code;
  } catch {
    return code;
  }
}

/**
 * What is attached, in words a person can read. The raw values (including the
 * exact build) are what is sent; see collectDiagnostics.
 */
export function diagnosticsRows() {
  const d = collectDiagnostics();
  const device =
    APP_PLATFORM === 'web'
      ? [d.browser, d.os].filter((v) => v && v !== 'Unknown').join(' on ') || 'Web browser'
      : d.os && d.os !== 'Unknown' ? `${d.os} phone` : 'Phone';
  return [
    { label: 'App', value: appVersionLabel() },
    { label: 'Device', value: device },
    d.screen ? { label: 'Screen', value: d.screen.replace('x', ' × ') } : null,
    d.language ? { label: 'Language', value: languageName(d.language) } : null,
  ].filter(Boolean);
}
