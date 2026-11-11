import { useEffect } from 'react';
import { isOnline, subscribeOnline } from '@shared/lib/networkStatus';
import { createOfflineNotice } from '@shared/lib/offlineNotice';
import { showToast } from '@shared/utils/toast';
import { IS_MOBILE_BUILD } from '@config';

/**
 * Renders nothing; says "You're offline" and "Back online" once each (see
 * `createOfflineNotice` for the rules). Mounted once, in `App`, for the website
 * and the app alike.
 */
export default function OfflineNotice() {
  useEffect(() => {
    const notice = createOfflineNotice({
      show: (message, kind) => {
        showToast(message, kind === 'online' ? 'success' : 'info', { duration: kind === 'online' ? 2000 : 4500 });
      },
      // A screen with something to read offline marks itself (Home's feed:
      // `data-offline-quiet`); interrupting it with the notice says nothing
      // the person needs.
      isQuiet: () => typeof document !== 'undefined' && Boolean(document.querySelector('[data-offline-quiet]')),
    });
    // The app opens on Home's saved feed, which paints a moment after this
    // mounts (a lazy route); the start-up check waits for it, so an offline
    // launch onto saved posts is not announced. The website starts at once.
    let startTimer = null;
    if (IS_MOBILE_BUILD) startTimer = setTimeout(() => notice.start(isOnline()), 1000);
    else notice.start(isOnline());
    const unsubscribe = subscribeOnline((online) => notice.change(online));
    return () => {
      clearTimeout(startTimer);
      unsubscribe();
      notice.dispose();
    };
  }, []);

  return null;
}
