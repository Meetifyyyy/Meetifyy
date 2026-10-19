import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@shared/context/AuthContext';
import { pushApi } from '@shared/api/apiClient';
import { showToast } from '@shared/utils/toast';
import { getPushService } from '@shared/push/pushPlatform';
import { disablePush, enablePush, getPushStatus } from '@shared/push/pushRegistration';
import styles from '../pages/SettingsRoute.module.css';
import own from './PushNotificationsSettings.module.css';

/**
 * Settings → Notifications → Push notifications. See docs/push-notifications.md.
 *
 * Replaces the old "Browser push alerts" checkbox, which saved a boolean and
 * registered nothing. Shows the device's permission honestly and separately
 * from the account preference: unavailable here (and why), blocked in the
 * browser or system (and where to change it, without asking again), or a
 * switch. Asking the OS happens only when the switch is turned on, which is
 * the user's gesture the browsers require.
 */
export const PUSH_CATEGORY_ROWS = [
  { key: 'messages', label: 'Messages', desc: 'Direct and group messages' },
  { key: 'likes', label: 'Likes', desc: 'Likes on your posts and comments' },
  { key: 'comments', label: 'Comments and replies', desc: 'On your posts and comments' },
  { key: 'mentions', label: 'Mentions', desc: 'When someone mentions you' },
  { key: 'follows', label: 'New followers', desc: 'When someone follows you' },
  { key: 'activities', label: 'Activities', desc: 'Invites, and people joining yours' },
  { key: 'communities', label: 'Communities', desc: 'People joining or asking to join yours' },
];

const UNAVAILABLE_TEXT = {
  install: 'On iPhone and iPad, add Meetifyy to your Home Screen, then turn this on from there.',
  'no-worker': 'Not available on this version of the site.',
  'not-configured': 'Not available in this version of the app.',
  server: "Push notifications aren't available yet.",
  browser: "This browser doesn't support push notifications.",
};

export default function PushNotificationsSettings() {
  const { currentUser } = useAuth();
  const userId = currentUser?.id;
  const [status, setStatus] = useState(null);
  const [prefs, setPrefs] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [nextStatus, nextPrefs] = await Promise.all([
      getPushStatus().catch(() => ({ available: false, reason: 'browser', permission: 'unsupported' })),
      pushApi.getPreferences().catch(() => null),
    ]);
    setStatus(nextStatus);
    setPrefs(nextPrefs);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onMaster = async (checked) => {
    if (busy) return;
    setBusy(true);
    try {
      if (checked) {
        const result = await enablePush({ userId });
        if (result === 'denied') {
          showToast('Notifications are blocked for Meetifyy on this device', 'error');
        }
      } else {
        await disablePush();
      }
    } catch (err) {
      showToast(err?.message || "Couldn't update push notifications", 'error');
    } finally {
      await load();
      setBusy(false);
    }
  };

  const onCategory = async (key, checked) => {
    const previous = prefs;
    setPrefs((p) => (p ? { ...p, categories: { ...p.categories, [key]: checked } } : p));
    try {
      setPrefs(await pushApi.updatePreferences({ [key]: checked }));
    } catch (err) {
      setPrefs(previous);
      showToast(err?.message || "Couldn't save that setting", 'error');
    }
  };

  const openSystemSettings = async () => {
    const service = await getPushService();
    await service?.openSystemSettings?.();
  };

  if (!status) {
    return (
      <div className={styles.toggleRow} aria-busy="true">
        <div className={styles.toggleInfo}>
          <span className={styles.rowLabel}>Push Notifications</span>
          <span className={styles.toggleDesc}>Checking this device…</span>
        </div>
      </div>
    );
  }

  const blocked = status.available && status.permission === 'denied';
  const on = Boolean(status.available && status.permission === 'granted' && prefs?.enabled);
  let desc = 'Alerts on this device when the app is closed';
  if (!status.available) desc = UNAVAILABLE_TEXT[status.reason] || UNAVAILABLE_TEXT.browser;
  else if (blocked)
    desc = status.canOpenSettings
      ? 'Turned off for Meetifyy in your phone settings.'
      : 'Blocked for this site. Allow notifications in your browser’s site settings to turn them on.';

  return (
    <>
      <div className={styles.toggleRow}>
        <div className={styles.toggleInfo}>
          <span className={styles.rowLabel} id="push-master-label">Push Notifications</span>
          <span className={styles.toggleDesc}>{desc}</span>
          {blocked && status.canOpenSettings ? (
            <button type="button" className={own.inlineAction} onClick={openSystemSettings}>
              Open settings
            </button>
          ) : null}
        </div>
        {status.available && !blocked ? (
          <label className={styles.toggle}>
            <input
              type="checkbox"
              aria-labelledby="push-master-label"
              checked={on}
              disabled={busy}
              onChange={(e) => void onMaster(e.target.checked)}
            />
            <span className={styles.slider} />
          </label>
        ) : null}
      </div>
      {on && prefs?.categories
        ? PUSH_CATEGORY_ROWS.map((row) => (
            <div key={row.key}>
              <div className={styles.nestedDivider} />
              <div className={`${styles.toggleRow} ${own.categoryRow}`}>
                <div className={styles.toggleInfo}>
                  <span className={styles.rowLabel} id={`push-${row.key}-label`}>{row.label}</span>
                  <span className={styles.toggleDesc}>{row.desc}</span>
                </div>
                <label className={styles.toggle}>
                  <input
                    type="checkbox"
                    aria-labelledby={`push-${row.key}-label`}
                    checked={prefs.categories[row.key] !== false}
                    onChange={(e) => void onCategory(row.key, e.target.checked)}
                  />
                  <span className={styles.slider} />
                </label>
              </div>
            </div>
          ))
        : null}
    </>
  );
}
