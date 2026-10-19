import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { IS_MOBILE_BUILD } from '@config';
import { useAuth } from '@shared/context/AuthContext';
import { pushApi } from '@shared/api/apiClient';
import { getPushService } from './pushPlatform';
import { enablePush, getPushStatus, syncPushRegistration } from './pushRegistration';
import { intentPath } from './intentPath';

/** Registration is refreshed off the critical path, after the app has settled. */
const SYNC_DELAY_MS = 4000;

/** Delay before the first-login permission request, so the app has painted. */
const FIRST_PROMPT_DELAY_MS = 1500;
const FIRST_PROMPT_KEY = 'meetifyy:push-first-prompt-done';

function firstPromptDone() {
  try {
    return window.localStorage.getItem(FIRST_PROMPT_KEY) === '1';
  } catch {
    return true; // cannot remember it, so never risk asking on every load
  }
}

function markFirstPromptDone() {
  try {
    window.localStorage.setItem(FIRST_PROMPT_KEY, '1');
  } catch {
    /* handled by firstPromptDone */
  }
}

/**
 * Keeps this device's push registration in step with the signed-in account,
 * and (on the website) routes notification clicks inside the app.
 *
 * Mounted once at the router root. The one time it prompts is the first
 * sign-in on a device: once signed in, it asks for permission a single time
 * (never at app load while signed out, and never again after that, whatever
 * the answer). Otherwise it only re-registers a
 * device whose permission is ALREADY granted, for an account whose push
 * preference is on — on sign-in, on reload (the browser may have rotated the
 * subscription), and when the platform reports a new token. Signed out, it
 * does nothing; sign-out itself drops the registration (AuthContext).
 *
 * Taps on the installed app are routed by DeepLinkNavigator, which also owns
 * the cold-start case.
 */
export default function PushSync() {
  const { isLoggedIn, currentUser } = useAuth();
  const userId = currentUser?.id;
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoggedIn || !userId) return undefined;
    let cancelled = false;
    let unsubscribe = () => {};

    const run = async () => {
      const service = await getPushService();
      if (cancelled || !service) return;
      // No request at all unless this device could receive pushes already.
      if ((await service.permissionState()) !== 'granted') return;
      const prefs = await pushApi.getPreferences().catch(() => null);
      if (cancelled || !prefs?.enabled) return;
      await syncPushRegistration({ userId, enabled: true });
    };

    const timer = setTimeout(() => void run(), SYNC_DELAY_MS);
    getPushService().then((service) => {
      if (cancelled || !service) return;
      unsubscribe = service.onToken(() => void run());
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      unsubscribe();
    };
  }, [isLoggedIn, userId]);

  useEffect(() => {
    if (!isLoggedIn || !userId || firstPromptDone()) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const status = await getPushStatus().catch(() => null);
      if (cancelled) return;
      // Decided already (granted/denied) or not offered here: nothing to ask.
      if (!status?.available || status.permission !== 'prompt') {
        if (status) markFirstPromptDone();
        return;
      }
      const prefs = await pushApi.getPreferences().catch(() => null);
      if (cancelled || !prefs || prefs.enabled) return;
      markFirstPromptDone();
      await enablePush({ userId }).catch(() => 'denied');
    }, FIRST_PROMPT_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isLoggedIn, userId]);

  useEffect(() => {
    if (IS_MOBILE_BUILD) return undefined;
    let cancelled = false;
    let unsubscribe = () => {};
    const open = (intent) => {
      const path = intentPath(intent);
      if (path) navigate(path, { state: { from: 'push' } });
    };
    getPushService().then((service) => {
      if (cancelled || !service) return;
      const pending = service.takePendingTap();
      if (pending) open(pending);
      unsubscribe = service.onNotificationTap(open);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [navigate]);

  return null;
}
