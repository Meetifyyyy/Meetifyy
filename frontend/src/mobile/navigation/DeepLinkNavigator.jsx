import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { intentToRoute } from './intentToRoute';

/**
 * Routes inbound links (App Links and notification taps) inside the router.
 *
 * Mounted once at the router root by the mobile entry (`App`'s `rootExtras`).
 * It only navigates: a destination that needs a signed-in user goes through
 * the same route guard as any other navigation, which records the path with
 * `setRedirectIntent` and returns the person to it after they sign in. There
 * is no second auth path for links.
 */
export default function DeepLinkNavigator({ deepLinks, push }) {
  const navigate = useNavigate();

  useEffect(() => {
    if (!deepLinks) return undefined;
    const open = (intent) => {
      const route = intentToRoute(intent);
      if (route) navigate(route, { state: { from: 'link' } });
    };
    // A link that cold-started the app arrived before this mounted.
    open(deepLinks.takePending());
    return deepLinks.onOpen(open);
  }, [deepLinks, navigate]);

  /*
   * Notification taps, the same way. The payload was already reduced to a
   * validated Intent by the push service (platform/capacitor/push.js), so only
   * a recognised destination is routed; the screen then applies its normal
   * authorization, and an inaccessible or deleted target shows its usual
   * not-found state.
   */
  useEffect(() => {
    if (!push) return undefined;
    const open = (intent) => {
      const route = intentToRoute(intent);
      if (route) navigate(route, { state: { from: 'push' } });
    };
    // A tap that cold-started the app arrived before this mounted.
    const pending = push.takePendingTap();
    if (pending) open(pending);
    return push.onNotificationTap(open);
  }, [push, navigate]);

  return null;
}
