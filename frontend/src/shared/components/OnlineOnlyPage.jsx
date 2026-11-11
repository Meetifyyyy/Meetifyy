import { useOnlineStatus } from '@shared/lib/networkStatus';
import { OfflineState } from '@shared/components/ui/StateViews';

/**
 * A page the device keeps nothing of (the Campus sub-pages: directory,
 * communities, events, confessions). Offline it says so plainly instead of
 * showing a spinner or an empty list that would read as "there is nothing
 * here"; back online, the page renders as usual. Pages that are kept for
 * offline (Home, Campus itself, Messages, Profile) are not wrapped.
 */
export default function OnlineOnlyPage({ children }) {
  const online = useOnlineStatus();
  if (online) return children;
  return (
    <main className="centre centre-wide" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
      <OfflineState title="No internet connection" message="This page will load when you're back online." />
    </main>
  );
}
