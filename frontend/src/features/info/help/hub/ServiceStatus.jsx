import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { healthApi } from '@shared/api/apiClient';
import { AlertTriangle } from '@shared/components/icons';
import styles from './HelpHub.module.css';

function useOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

/**
 * A notice that appears only when something is wrong; a permanent "All
 * systems operational" line would be noise on every visit. Offline is told
 * apart from an outage, because the fix is on the reader's side.
 */
export default function ServiceStatus() {
  const online = useOnline();
  const { isError } = useQuery({
    queryKey: ['api-health'],
    queryFn: () => healthApi.check(),
    enabled: online,
    retry: 1,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  if (!online) {
    return (
      <p className={styles.statusBanner} role="status">
        <AlertTriangle size={16} aria-hidden="true" />
        You are offline. Help articles may not load until you reconnect.
      </p>
    );
  }
  if (!isError) return null;
  return (
    <p className={styles.statusBanner} role="status">
      <AlertTriangle size={16} aria-hidden="true" />
      Meetifyy is having trouble right now and some things may not work. We are on it, no need to report it.
    </p>
  );
}
