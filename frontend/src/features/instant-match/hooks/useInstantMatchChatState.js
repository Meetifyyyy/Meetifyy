import { useState, useEffect, useCallback, useRef } from 'react';
import matchSocketClient from '../utils/matchSocketClient';

/**
 * The client's view of the dedicated Instant Match chat.
 *
 * The server owns this state completely. This hook does three things and
 * deliberately no more:
 *
 *  1. Pulls the authoritative state on mount, on reconnect, and whenever the
 *     tab regains focus.
 *  2. Applies pushed `instant_match:chat_ended` events on top.
 *  3. Never decides on its own that a chat has ended.
 *
 * That third point is the important one. A phone suspended for six hours
 * wakes with a countdown that has drifted; a tab left open overnight has a
 * timer that fired into a dead component. Neither may be allowed to *decide*
 * anything — when this hook's own clock reaches zero it asks the server what
 * happened rather than assuming, so the answer is always the row's answer.
 */
export function useInstantMatchChatState({ enabled = true, onSessionEnded } = {}) {
  const [chat, setChat] = useState(null);
  const [loading, setLoading] = useState(true);

  // Called with the conversation id of a session that has just stopped being
  // live, so the owner can drop every cache keyed by it. Held in a ref so a
  // caller passing an inline function does not re-subscribe the socket
  // listener below on every render.
  const onSessionEndedRef = useRef(onSessionEnded);
  onSessionEndedRef.current = onSessionEnded;

  // The session ids we have already reported as ended, so a duplicate socket
  // event (or an event racing the refresh it triggered) cleans up once.
  const purgedRef = useRef(new Set());

  /**
   * Announce an ending exactly once per session.
   *
   * The cleanup this drives — dropping the query cache and the IndexedDB rows
   * for the conversation — is what stops an ended session's messages being
   * rebuilt on the client. The server has already deleted them; this is the
   * matching half on the device.
   */
  const reportEnded = useCallback((state) => {
    if (!state?.matchId || state.isActive) return;
    if (purgedRef.current.has(state.matchId)) return;
    purgedRef.current.add(state.matchId);
    try {
      onSessionEndedRef.current?.(state);
    } catch (_) {
      // Cleanup is best-effort; never let it break the state transition.
    }
  }, []);

  // Guards against an in-flight refresh being overtaken by a newer one, and
  // against applying a response after unmount.
  const requestSeq = useRef(0);
  const mounted = useRef(true);

  // The matchId of an ended session the user has already been told about and
  // dismissed. The server keeps answering with that row (correctly — it is the
  // last thing that happened), so without this the "they left" panel came back
  // every time the tab regained focus or the socket reconnected, and reopening
  // Instant Match showed the ending again instead of a fresh search.
  const dismissedMatchId = useRef(null);

  /** Ended + already acknowledged = nothing to show. */
  const isDismissed = useCallback(
    (state) => Boolean(state && !state.isActive && state.matchId === dismissedMatchId.current),
    [],
  );

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const refresh = useCallback(async () => {
    if (!enabled) return null;
    const seq = ++requestSeq.current;

    const res = await matchSocketClient.chatState();
    // A slower earlier request must never clobber a newer answer.
    if (!mounted.current || seq !== requestSeq.current) return null;

    setLoading(false);
    if (!res.ok) return null;

    const next = res.data?.state ?? null;
    reportEnded(next);
    if (isDismissed(next)) {
      setChat(null);
      return null;
    }
    setChat(next);
    return next;
  }, [enabled, isDismissed, reportEnded]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return undefined;
    }

    refresh();

    /**
     * Pushed endings. Idempotent by construction: the payload is the same
     * shape `refresh` returns, so applying it twice — a duplicate socket
     * event, or an event that races the refresh it triggered — lands on the
     * same state rather than transitioning twice or stacking two "they left"
     * banners.
     */
    const offEnded = matchSocketClient.on('instant_match:chat_ended', (state) => {
      if (!state?.matchId) return;
      reportEnded(state);
      if (isDismissed(state)) return;
      setChat((current) => {
        // An event for a match we have already moved on from is noise.
        if (current && current.matchId !== state.matchId) return current;
        return state;
      });
    });

    // A reconnect may have spanned an ending we never saw.
    const offTransport = matchSocketClient.on('transport:status', ({ connected }) => {
      if (connected) refresh();
    });

    // Returning to a backgrounded tab is the other way to miss everything.
    const onVisible = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      offEnded();
      offTransport();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, refresh, isDismissed, reportEnded]);

  /**
   * Leave the match. The server claims the transition, so calling this twice
   * (double tap, two tabs) is safe; both callers receive the resulting state.
   */
  const leave = useCallback(async (matchId) => {
    const res = await matchSocketClient.leaveChat(matchId);
    if (!res.ok) return { ok: false, error: res.error };
    // The ended row the server hands back is history for the person who just
    // walked away, so it is acknowledged here rather than re-rendered at them.
    if (res.data?.state && !res.data.state.isActive) {
      dismissedMatchId.current = res.data.state.matchId;
      reportEnded(res.data.state);
    }
    if (mounted.current && res.data?.state) setChat(res.data.state);
    return { ok: true, state: res.data?.state ?? null };
  }, [reportEnded]);

  /**
   * Acknowledge an ended session: the user has read the ending and closed it.
   * The row stays on the server; this only stops it being re-shown here, so the
   * next visit to Instant Match starts at step one.
   */
  const dismissEnded = useCallback(() => {
    setChat((current) => {
      if (current && !current.isActive) {
        dismissedMatchId.current = current.matchId;
        return null;
      }
      return current;
    });
  }, []);

  /**
   * Seed the hook from the application's boot read.
   *
   * Same rules as a socket answer — a dismissed ending stays dismissed, an
   * ending is reported for cleanup — so the HTTP path and the socket path can
   * never leave the client in two different states. `loading` clears here
   * because for a cold start this *is* the answer; the socket resync that
   * follows only confirms it.
   */
  const hydrate = useCallback((state) => {
    if (!mounted.current) return;
    setLoading(false);
    reportEnded(state);
    if (!state || isDismissed(state)) {
      setChat(null);
      return;
    }
    setChat(state);
  }, [isDismissed, reportEnded]);

  /** Called when the local countdown reaches zero. Asks rather than assumes —
   *  the deadline the client holds is a rendering hint, not a verdict. */
  const onCountdownElapsed = useCallback(() => { refresh(); }, [refresh]);

  return {
    chat, loading, refresh, leave, onCountdownElapsed, setChat, dismissEnded, hydrate,
  };
}
