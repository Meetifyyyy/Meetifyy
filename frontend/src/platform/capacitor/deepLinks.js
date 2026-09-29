import { App } from '@capacitor/app';
import { parseIntentFromPath } from '../../core/navigation/intents';

/**
 * Inbound links, as a `DeepLinks` (platform/contracts.ts).
 *
 * Android delivers a verified App Link (`https://<site>/post/123`, see the
 * intent filter in AndroidManifest.xml) to MainActivity, and `@capacitor/app`
 * reports it as `appUrlOpen` — or, for the link that cold-started the app, as
 * `getLaunchUrl()`. Either way the URL is reduced to an `Intent` by
 * `parseIntentFromPath`, the same validator push payloads go through, so only
 * a recognised destination is ever routed and anything else just opens the
 * app.
 *
 * Only this app's own hosts are accepted. The intent filter already limits
 * which links Android sends here, but a link can also arrive from another
 * app's explicit intent, and a foreign host must not be able to steer the
 * app's navigation.
 */
export function createCapacitorDeepLinks({ allowedHosts }) {
  const hosts = new Set(allowedHosts.filter(Boolean).map((h) => h.toLowerCase()));
  let pending = null;
  const listeners = new Set();

  const toIntent = (url) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || !hosts.has(parsed.hostname.toLowerCase())) return null;
      return parseIntentFromPath(parsed.pathname);
    } catch {
      return null;
    }
  };

  const deliver = (intent) => {
    if (!intent) return;
    if (listeners.size === 0) {
      pending = intent;
      return;
    }
    listeners.forEach((listener) => listener(intent));
  };

  App.addListener('appUrlOpen', (event) => deliver(toIntent(event?.url)));
  App.getLaunchUrl()
    .then((launch) => {
      if (launch?.url) deliver(toIntent(launch.url));
    })
    .catch(() => {
      // No launch URL is the ordinary cold start.
    });

  return {
    onOpen(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    takePending() {
      const intent = pending;
      pending = null;
      return intent;
    },
  };
}
