import { useEffect, useRef } from 'react';
import { isOnline, subscribeOnline } from '@shared/lib/networkStatus';
import { createOfflineNotice, OFFLINE_MESSAGE_SIGNED_OUT } from '@shared/lib/offlineNotice';
import { useAuth } from '@shared/context/AuthContext';
import { showToast } from '@shared/utils/toast';

/**
 * Renders nothing; says "You're offline…" and "Back online" once each (see
 * `createOfflineNotice` for the rules). Mounted once, in `App`, for the website
 * and the app alike.
 */
export default function OfflineNotice() {
  // Read when the notice shows, not when it was set up: the effect runs once,
  // and sign-in can change after it. Signed out, "Showing what was saved"
  // would be untrue (a landing page has nothing saved), so the wording differs.
  const { isLoggedIn } = useAuth();
  const signedInRef = useRef(isLoggedIn);
  signedInRef.current = isLoggedIn;

  useEffect(() => {
    const notice = createOfflineNotice({
      show: (message, kind) => {
        const text = kind === 'offline' && !signedInRef.current ? OFFLINE_MESSAGE_SIGNED_OUT : message;
        showToast(text, kind === 'online' ? 'success' : 'info', { duration: kind === 'online' ? 2000 : 4500 });
      },
    });
    notice.start(isOnline());
    const unsubscribe = subscribeOnline((online) => notice.change(online));
    return () => {
      unsubscribe();
      notice.dispose();
    };
  }, []);

  return null;
}
