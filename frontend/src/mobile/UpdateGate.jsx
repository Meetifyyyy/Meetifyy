import { useCallback, useEffect, useRef, useState } from 'react';

import { evaluateVersion } from '@core/version/compareVersions';
import { apiClient } from '../shared/api/apiClient';
import { createCapacitorAppInfo } from '../platform/capacitor/appInfo';

import styles from './UpdateGate.module.css';

/**
 * Stops an unsupported build from talking to the API, and nudges a merely old one.
 *
 * WHY THIS EXISTS AT ALL
 * The installed app carries its own copy of the web bundle, so a frontend
 * deploy does not reach it. Every build ever shipped stays a client of this API
 * until its user chooses to update, and there is no way to push them a fix.
 * That makes "the oldest build still in the wild" a real constraint on every
 * backend change — and without a gate, the only way to discover it is a support
 * message from somebody whose app broke.
 *
 * TWO TIERS, DELIBERATELY
 * `blocked` is a wall: the app is not rendered at all. `outdated` is a banner
 * the user can dismiss. One threshold instead of two would mean every routine
 * release forces an upgrade, which is how these gates end up being quietly
 * disabled by the people they protect.
 *
 * FAIL-OPEN, EVERYWHERE
 * Any failure — offline, a 500, a malformed response, a version that cannot be
 * read — renders the app. A gate that fails closed turns a typo in an
 * environment variable into every user being locked out of a working app, with
 * no way to reach them. The wall only ever appears on a clear, well-formed
 * answer from the server.
 *
 * This component is mobile-only. It lives in `src/mobile/`, which the web entry
 * never imports, so the website neither runs it nor ships it.
 */
export default function UpdateGate({ children }) {
  const [status, setStatus] = useState('ok');
  const [updateUrl, setUpdateUrl] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  // Held in a ref so the effect does not re-run when it is re-created, and so
  // the cached version survives a re-render.
  const appInfoRef = useRef(null);
  if (appInfoRef.current === null) appInfoRef.current = createCapacitorAppInfo();

  const check = useCallback(async () => {
    try {
      const appInfo = appInfoRef.current;
      const [current, platform] = await Promise.all([
        appInfo.appVersion(),
        Promise.resolve(appInfo.platform()),
      ]);

      // Nothing to compare against. Not an error — see fail-open above.
      if (!current || (platform !== 'android' && platform !== 'ios')) return;

      const body = await apiClient.get('/api/app/version');
      const rules = body?.[platform];
      if (!rules) return;

      const verdict = evaluateVersion({
        current,
        minimum: rules.minimumVersion,
        latest: rules.latestVersion,
      });

      setUpdateUrl(typeof rules.updateUrl === 'string' ? rules.updateUrl : null);
      setStatus(verdict);
    } catch {
      // Offline, rate-limited, mid-deploy, malformed. Says nothing about the
      // build, so it must not gate it.
    }
  }, []);

  /**
   * Checked once per cold start, and again whenever the app returns to the
   * foreground.
   *
   * The second is what makes the wall appear for somebody who left the app open
   * for a week; the first is what catches everyone else. Both are cheap — one
   * small request against a route the server caches — and neither is on a
   * timer, because a poll would spend battery to learn something that changes
   * a handful of times a year.
   */
  useEffect(() => {
    check();

    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [check]);

  const openStore = useCallback(() => {
    if (updateUrl) window.open(updateUrl, '_system');
  }, [updateUrl]);

  if (status === 'blocked') {
    return (
      <div className={styles.wall} role="alertdialog" aria-labelledby="update-wall-title">
        <img className={styles.logo} src="/logo-mark.png" alt="" />
        <h1 className={styles.title} id="update-wall-title">
          Time to update
        </h1>
        <p className={styles.body}>
          This version of Meetifyy is no longer supported. Update to the latest version to
          carry on.
        </p>
        {/* No dismiss, and no "later". That is what makes it a wall rather than
            a strongly worded banner. */}
        {updateUrl ? (
          <button className={styles.primary} type="button" onClick={openStore}>
            Update Meetifyy
          </button>
        ) : (
          <p className={styles.body}>Please update Meetifyy from your app store.</p>
        )}
      </div>
    );
  }

  return (
    <>
      {children}
      {status === 'outdated' && !dismissed && (
        <div className={styles.banner} role="status">
          <span className={styles.bannerText}>A new version of Meetifyy is available.</span>
          {updateUrl && (
            <button className={styles.bannerAction} type="button" onClick={openStore}>
              Update
            </button>
          )}
          {/* Dismissal is per app-session and deliberately not persisted: it
              should come back on the next cold start, not be silenced forever
              by one stray tap. */}
          <button
            className={styles.bannerDismiss}
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}
