import { useCallback, useEffect, useRef, useState } from 'react';
import matchSocketClient from '../utils/matchSocketClient';

/**
 * Bursts of queue movement are collapsed into one re-read.
 *
 * `queue:changed` fires for every join, cancel, match and expiry on the
 * platform, so on a busy evening it can arrive several times a second for
 * reasons that have nothing to do with this viewer. Reading once per window
 * keeps the list live without spending a round trip — or a slice of the
 * server's per-user budget — on each individual event.
 */
const COALESCE_MS = 1500;

/**
 * The live "who is searching right now" roster.
 *
 * The server owns the list: it is built from the queue rows themselves, per
 * viewer, so there is nothing here to keep in step with it. This hook only
 * decides *when* to ask — on mount, when the queue moves, and after a
 * reconnect, since an event that arrived while the socket was down was never
 * delivered and no amount of patching local state would recover it.
 *
 * A refresh never blanks what is already on screen. The first read owns the
 * loading state; every later one replaces the rows only if it succeeds, so a
 * momentary failure leaves a slightly stale list rather than an empty screen.
 */
export function useSearchingNow(enabled = true) {
  const [people, setPeople] = useState(null);
  const [error, setError] = useState(null);

  // Read inside callbacks that must not be re-created when the data changes.
  const loadedRef = useRef(false);
  const aliveRef = useRef(true);
  const inFlightRef = useRef(false);
  const timerRef = useRef(null);

  const load = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    const res = await matchSocketClient.listQueue();

    inFlightRef.current = false;
    if (!aliveRef.current) return;

    if (res.ok) {
      setPeople(Array.isArray(res.data?.people) ? res.data.people : []);
      setError(null);
      loadedRef.current = true;
      return;
    }
    // Keep the rows we have. Only a viewer with nothing on screen is told
    // the read failed — for everyone else the next refresh corrects it.
    if (!loadedRef.current) setError(res.error || 'Could not load who is searching');
  }, []);

  /** Trailing-edge refresh, so a flurry of queue events costs one read. */
  const scheduleRefresh = useCallback(() => {
    if (timerRef.current) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      load();
    }, COALESCE_MS);
  }, [load]);

  const retry = useCallback(() => {
    setError(null);
    load();
  }, [load]);

  useEffect(() => {
    if (!enabled) return undefined;

    aliveRef.current = true;
    // Instant Match rides the app's shared socket; this is reference-counted,
    // so holding it here cannot detach it from the provider.
    const release = matchSocketClient.acquire();

    load();

    const offChanged = matchSocketClient.on('queue:changed', scheduleRefresh);
    // A reconnect means events were missed while the socket was down, so the
    // roster is re-read rather than trusted.
    const offStatus = matchSocketClient.on('transport:status', ({ connected }) => {
      if (connected && loadedRef.current) scheduleRefresh();
    });

    return () => {
      aliveRef.current = false;
      offChanged();
      offStatus();
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      release();
    };
  }, [enabled, load, scheduleRefresh]);

  return {
    /** null until the first read lands — that is the loading state. */
    people,
    loading: people === null && !error,
    error,
    retry,
  };
}
