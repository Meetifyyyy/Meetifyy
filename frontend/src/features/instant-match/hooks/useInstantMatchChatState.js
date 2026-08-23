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
export function useInstantMatchChatState({ enabled = true } = {}) {
  const [chat, setChat] = useState(null);
  const [loading, setLoading] = useState(true);

  // Guards against an in-flight refresh being overtaken by a newer one, and
  // against applying a response after unmount.
  const requestSeq = useRef(0);
  const mounted = useRef(true);

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
    setChat(next);
    return next;
  }, [enabled]);

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
  }, [enabled, refresh]);

  /**
   * Leave the match. The server claims the transition, so calling this twice
   * (double tap, two tabs) is safe; both callers receive the resulting state.
   */
  const leave = useCallback(async (matchId) => {
    const res = await matchSocketClient.leaveChat(matchId);
    if (!res.ok) return { ok: false, error: res.error };
    if (mounted.current && res.data?.state) setChat(res.data.state);
    return { ok: true, state: res.data?.state ?? null };
  }, []);

  /** Called when the local countdown reaches zero. Asks rather than assumes —
   *  the deadline the client holds is a rendering hint, not a verdict. */
  const onCountdownElapsed = useCallback(() => { refresh(); }, [refresh]);

  return { chat, loading, refresh, leave, onCountdownElapsed, setChat };
}
