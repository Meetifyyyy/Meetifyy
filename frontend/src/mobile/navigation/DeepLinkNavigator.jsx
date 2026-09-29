import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { intentToRoute } from './intentToRoute';

/**
 * Routes inbound links (App Links, and later push taps) inside the router.
 *
 * Mounted once at the router root by the mobile entry (`App`'s `rootExtras`).
 * It only navigates: a destination that needs a signed-in user goes through
 * the same route guard as any other navigation, which records the path with
 * `setRedirectIntent` and returns the person to it after they sign in. There
 * is no second auth path for links.
 */
export default function DeepLinkNavigator({ deepLinks }) {
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

  return null;
}
