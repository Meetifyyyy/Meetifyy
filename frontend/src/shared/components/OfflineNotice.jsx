import { useEffect } from 'react';
import { isOnline, subscribeOnline } from '@shared/lib/networkStatus';
import { createOfflineNotice } from '@shared/lib/offlineNotice';
import { showToast } from '@shared/utils/toast';

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
