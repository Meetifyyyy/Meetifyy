import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { sessionsApi } from '@shared/api/apiClient';
import { showToast } from '@shared/utils/toast';
import { Devices, Smartphone, LogOut } from '@shared/components/icons';
import styles from './DevicesPanel.module.css';
import RowSkeleton from '@shared/components/skeletons/RowSkeleton';
import { useGuardedMutation } from '@shared/hooks/useGuardedMutation';

/**
 * The devices signed in to this account.
 *
 * Reads the `UserSession` rows directly, which is what makes this list
 * trustworthy rather than decorative: a row here is exactly the thing that
 * authorizes a request, so signing one out is not a hint to some other system,
 * it is the revocation itself. Before those rows existed there was nothing to
 * list and nothing to end — a token, once issued, worked until it expired.
 */

/** "3 minutes ago", "2 days ago" — enough to recognise a session, no more. */
function relativeTime(value) {
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return '';
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));

  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(value).toLocaleDateString();
}

/**
 * What the second line of a row says.
 *
 * Platform and recency only. The server no longer sends an address and this
 * page must not show one; what identifies a device to its owner is what it is
 * (the app or a browser) and when it was last used.
 */
function describeRow(session) {
  const where = session.client === 'app' ? 'Meetifyy app' : 'Website';
  if (session.current) return `${where} · Active now`;
  const when = relativeTime(session.lastActiveAt);
  return when ? `${where} · Last active ${when}` : where;
}

export default function DevicesPanel() {
  const queryClient = useQueryClient();
  const [confirmingAll, setConfirmingAll] = useState(false);

  const {
    data: sessions,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['auth', 'sessions'],
    queryFn: () => sessionsApi.list(),
    // A device list that is minutes stale is worse than useless on the screen
    // where someone is trying to end a session they do not recognise.
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] });
  }, [queryClient]);

  const revokeOne = useGuardedMutation(useMutation({
    mutationFn: (id) => sessionsApi.revoke(id),
    onSuccess: () => {
      showToast('Signed out of that device');
      invalidate();
    },
    onError: (err) => {
      showToast(err?.message || "Couldn't sign out that device", 'error');
      // Already gone (signed out elsewhere, or expired) answers 404; either way
      // the list on screen is wrong, so refresh it.
      invalidate();
    },
  }), 'action');

  const revokeOthers = useGuardedMutation(useMutation({
    mutationFn: () => sessionsApi.revokeOthers(),
    onSuccess: (result) => {
      const count = result?.revoked ?? 0;
      showToast(
        count > 0
          ? `Signed out of ${count} other device${count === 1 ? '' : 's'}`
          : 'No other devices were signed in',
      );
      setConfirmingAll(false);
      invalidate();
    },
    onError: (err) => {
      showToast(err?.message || "Couldn't sign out the other devices", 'error');
      setConfirmingAll(false);
    },
  }), 'action');

  const intro = (
    <p className={styles.intro}>
      You&apos;re signed in on these devices. If you don&apos;t recognise one,
      sign it out. It stops working straight away.
    </p>
  );

  if (isLoading) {
    // The explanation is static and renders for real; only the device rows,
    // which are what is actually being fetched, are placeholders.
    return (
      <div className={styles.wrap}>
        {intro}
        <RowSkeleton
          count={3}
          avatarSize="36px"
          avatarRadius="10px"
          className={styles.list}
          rowClassName={styles.row}
          label="Loading your devices"
        />
      </div>
    );
  }

  if (isError) {
    return (
      <div className={styles.state}>
        <span className={styles.stateText}>Couldn&apos;t load your devices.</span>
        <button type="button" className={styles.retryBtn} onClick={() => refetch()}>
          Try again
        </button>
      </div>
    );
  }

  const list = Array.isArray(sessions) ? sessions : [];
  const others = list.filter((s) => !s.current);

  return (
    <div className={styles.wrap}>
      {intro}

      <div className={styles.list}>
        {list.map((session) => (
          <div key={session.id} className={styles.row}>
            <span className={styles.icon} aria-hidden="true">
              {session.client === 'app' ? (
                <Smartphone size={20} strokeWidth={2} />
              ) : (
                <Devices size={20} strokeWidth={2} />
              )}
              {session.current && <span className={styles.currentDot} />}
            </span>

            <span className={styles.info}>
              <span className={styles.name}>
                {session.deviceName || 'Unknown device'}
                {session.current && <span className={styles.srOnly}> (This device)</span>}
              </span>
              <span className={styles.meta}>{describeRow(session)}</span>
            </span>

            {!session.current && (
              <button
                type="button"
                className={styles.revokeBtn}
                disabled={revokeOne.isPending}
                onClick={() => revokeOne.mutate(session.id)}
                aria-label={`Sign out ${session.deviceName || 'this device'}`}
              >
                {revokeOne.isPending && revokeOne.variables === session.id
                  ? 'Signing out…'
                  : 'Sign out'}
              </button>
            )}
          </div>
        ))}

        {list.length === 0 && (
          <div className={styles.row}>
            <span className={styles.meta}>No signed-in devices found.</span>
          </div>
        )}
      </div>

      {others.length > 0 && (
        <div className={styles.allWrap}>
          {confirmingAll ? (
            <div className={styles.confirmRow}>
              <span className={styles.confirmText}>
                Sign out of {others.length} other device
                {others.length === 1 ? '' : 's'}? This device stays signed in.
              </span>
              <div className={styles.confirmActions}>
                <button
                  type="button"
                  className={styles.cancelBtn}
                  onClick={() => setConfirmingAll(false)}
                  disabled={revokeOthers.isPending}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={styles.dangerBtn}
                  onClick={() => revokeOthers.mutate()}
                  disabled={revokeOthers.isPending}
                >
                  {revokeOthers.isPending ? 'Signing out…' : 'Sign them out'}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className={styles.allBtn}
              onClick={() => setConfirmingAll(true)}
            >
              <LogOut size={16} strokeWidth={2} />
              Sign out of all other devices
            </button>
          )}
        </div>
      )}
    </div>
  );
}
