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

/** One line telling the user exactly what is attached, e.g. "Android app 1.0+ab12 · Android · 1080x2400". */
export function diagnosticsSummary() {
  const d = collectDiagnostics();
  const where = APP_PLATFORM === 'web' ? `${d.browser} on ${d.os}` : d.os;
  return [appVersionLabel(), where, d.screen].filter(Boolean).join(' · ');
}
