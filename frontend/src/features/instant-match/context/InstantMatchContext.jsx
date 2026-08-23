import {
  createContext, useContext, useState, useEffect, useCallback, useRef, useMemo,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@shared/context/AuthContext';
import { getCollegeName } from '@shared/utils/user';
import { showToast } from '@shared/utils/toast';

import matchSocketClient from '../utils/matchSocketClient';
import { useInstantMatchChatState } from '../hooks/useInstantMatchChatState';
import {
  MATCH_ACTIVITIES,
  TIME_PREFERENCES,
  CAMPUS_AREAS,
  ACTIVITY_DETAILS_CONFIG,
  OPTIONAL_DETAIL_MAX,
  STEP_ACTIVITY, STEP_TIME, STEP_DETAILS, STEP_LOCATION, STEP_SEARCHING,
} from '../constants/matchConstants';

/** Exported so the DEV-only preview route can drive the UI with fixed state.
 *  Application code should always go through `useInstantMatch`. */
export const InstantMatchContext = createContext(null);

/**
 * Client status. The server is authoritative for everything that outlives a
 * render — this only tracks what the user is currently looking at.
 *
 *   idle        nothing in flight
 *   searching   queued on the server, waiting for a partner
 *   match_found a live match is on screen, awaiting a response
 *   waiting     we accepted; the other side has not answered yet
 *   timed_out   our countdown emptied; the server is about to reconcile
 *   matched     both accepted; the chat is opening
 */
const initialFormData = {
  activity: '',
  timePreference: '',
  optionalDetail: '',
  location: { area: '', gps: null },
};

// `count` is everyone on Instant Match right now; `sameActivity` is the
// subset searching for the same thing as this user.
const initialStats = { count: 0, sameActivity: 0, avgWaitSecs: 0 };

/** Client-side mirror of the server's validation. Catches mistakes before a
 *  round trip; the backend re-checks everything regardless. */
export function validateRequest(formData) {
  if (!MATCH_ACTIVITIES.some((a) => a.id === formData.activity)) {
    return { valid: false, step: STEP_ACTIVITY, message: 'Pick an activity to continue' };
  }
  if (!TIME_PREFERENCES.some((t) => t.id === formData.timePreference)) {
    return { valid: false, step: STEP_TIME, message: 'Pick when you want to meet' };
  }
  const needsDetail = Boolean(ACTIVITY_DETAILS_CONFIG[formData.activity]);
  if (needsDetail && formData.optionalDetail.length > OPTIONAL_DETAIL_MAX) {
    return { valid: false, step: STEP_DETAILS, message: 'That detail is a little too long' };
  }
  const area = formData.location?.area;
  if (area && !CAMPUS_AREAS.some((a) => a.id === area)) {
    return { valid: false, step: STEP_LOCATION, message: 'Pick a campus area from the list' };
  }
  return { valid: true };
}

export function InstantMatchProvider({ children }) {
  const { currentUser } = useAuth();
  const queryClient = useQueryClient();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [step, setStep] = useState(STEP_ACTIVITY);
  const [formData, setFormData] = useState(initialFormData);

  const [status, setStatus] = useState('idle');
  const [queueStats, setQueueStats] = useState(initialStats);
  const [activeMatch, setActiveMatch] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [restoring, setRestoring] = useState(true);
  // The last mutually-accepted match, so reopening Instant Match shows who
  // you were paired with instead of a blank form. Server-owned, so it
  // survives reloads and follows the user across devices.
  const [recentMatch, setRecentMatch] = useState(null);

  // ── Dedicated chat ─────────────────────────────────────────────────────────
  // The 24h conversation is its own state machine, owned by the server. This
  // provider holds the overlay's open/closed flag; everything about whether
  // the chat exists, is live, or has ended comes from the hook.
  const [chatOverlayOpen, setChatOverlayOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const {
    chat, refresh: refreshChat, leave: leaveChatSession, onCountdownElapsed,
  } = useInstantMatchChatState({ enabled: Boolean(currentUser?.id) });

  const statusRef = useRef(status);
  statusRef.current = status;

  const chatRef = useRef(chat);
  chatRef.current = chat;

  // Read inside callbacks that must not re-create themselves (and re-render
  // every consumer) each time a new match lands.
  const recentMatchRef = useRef(recentMatch);
  recentMatchRef.current = recentMatch;

  // One navigation at a time: double-tapping "Open chat" during the resync
  // below would otherwise fire two syncs and two navigations.
  const openingChatRef = useRef(false);

  // One leave at a time. Two tabs or a double tap are both safe on the
  // server, but there is no reason to spend the round trips.
  const leavingRef = useRef(false);

  // Guards a second submit while the first is still in flight, closing the
  // double-tap window that a `busy` state alone leaves open across renders.
  const inFlightRef = useRef(false);

  // The celebration-then-navigate timer. Held so unmounting (or a state
  // change that outruns it) cannot fire a navigation into a dead tree.
  const matchedHandoffRef = useRef(null);
  useEffect(() => () => {
    if (matchedHandoffRef.current) window.clearTimeout(matchedHandoffRef.current);
  }, []);

  const isBusyState = status === 'match_found' || status === 'waiting' || status === 'matched';

  // ── Transport ───────────────────────────────────────────────────────────────
  // Held for the provider's whole lifetime. Instant Match rides the app's
  // existing socket, so this costs nothing extra and means a match can arrive
  // while the sheet is closed or minimised.
  useEffect(() => {
    if (!currentUser?.id) return undefined;
    return matchSocketClient.acquire();
  }, [currentUser?.id]);

  /**
   * Pulls authoritative state from the server. Runs on mount and after every
   * reconnect, so a page reload or a dropped connection mid-search restores
   * the real state instead of stranding the user on a dead screen.
   */
  const resync = useCallback(async () => {
    const res = await matchSocketClient.sync();
    if (!res.ok) {
      setRestoring(false);
      return;
    }
    const state = res.data?.state;
    setRestoring(false);
    if (!state) return;

    setRecentMatch(state.recentMatch ?? null);

    if (state.pendingMatch) {
      // Only adopt a pending match we are not already mid-response on —
      // otherwise a reconnect while the accept is in flight would throw the
      // user back to an un-answered card they have already answered.
      if (statusRef.current !== 'waiting' && inFlightRef.current === false) {
        setActiveMatch(state.pendingMatch);
        setStatus('match_found');
      }
      return;
    }
    if (state.queued) {
      setFormData((prev) => ({
        ...prev,
        activity: state.queued.activity,
        timePreference: state.queued.timePreference,
        optionalDetail: state.queued.optionalDetail || '',
        location: { ...prev.location, area: state.queued.area || '' },
      }));
      setQueueStats(state.stats || initialStats);
      setStatus('searching');
      setStep(STEP_SEARCHING);
      return;
    }
    // Server says we are neither queued nor holding a live match. Settle on
    // the state its data actually supports: `matched` while the 24h chat is
    // still alive, otherwise idle. This is the single place a stale
    // searching/matched screen gets corrected after a reload or reconnect.
    const hasLiveChat = Boolean(state.recentMatch?.chatId);
    setActiveMatch(null);
    setStatus((prev) => {
      // A handoff animation in flight owns the state until its timer fires.
      if (prev === 'matched' && matchedHandoffRef.current) return prev;
      if (hasLiveChat) return 'matched';
      return prev === 'idle' ? prev : 'idle';
    });
  }, []);

  useEffect(() => {
    if (!currentUser?.id) return undefined;

    const offStatus = matchSocketClient.on('transport:status', ({ connected: isUp }) => {
      setConnected(isUp);
      if (isUp) resync();
    });

    const offStats = matchSocketClient.on('queue:stats', (stats) => {
      if (stats && typeof stats.count === 'number') setQueueStats(stats);
    });

    const offFound = matchSocketClient.on('match:found', (match) => {
      if (!match?.matchId || !match?.candidate) return;
      setError(null);
      setActiveMatch(match);
      setStatus('match_found');
      notifyMatchFound(match);
    });

    const offAccepted = matchSocketClient.on('match:accepted', (payload = {}) => {
      const { chatId, matchId, candidate, activity, expiresAt } = payload;
      setStatus('matched');
      setSheetOpen(false);

      // The server now sends the pairing with the acceptance, so the Matched
      // state no longer depends on this tab having seen `match:found`. That
      // is what makes it survive a reload, a second device, or a socket that
      // reconnected between the match and the accept.
      setActiveMatch((current) => {
        const resolved = candidate || current?.candidate || null;
        if (resolved) {
          setRecentMatch({
            matchId: matchId || current?.matchId || null,
            candidate: resolved,
            activity: activity || current?.activity || '',
            chatId: chatId ?? null,
            expiresAt: expiresAt ?? null,
            matchedAt: Date.now(),
          });
        }
        return current;
      });

      // The conversation list has a new chat in it now. Refetch rather than
      // invalidate-and-wait so the chat route finds it already cached.
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      queryClient.refetchQueries({ queryKey: ['conversations'], type: 'active' });

      // Hold the celebration briefly, then hand over to the chat.
      matchedHandoffRef.current = window.setTimeout(() => {
        matchedHandoffRef.current = null;
        setActiveMatch(null);
        setFormData(initialFormData);
        setStep(STEP_ACTIVITY);
        // Deliberately NOT back to 'idle': the user has a live 24h chat, and
        // the launcher must keep saying so. `matched` clears when the chat
        // expires, when they dismiss it, or when they start a new search.
        setStatus('matched');
        // The celebration hands over to the *dedicated* Instant Match chat,
        // never to /messages. This conversation is not listed there and does
        // not belong there; routing into Messages would undo the separation
        // the whole feature depends on.
        refreshChat().then((fresh) => {
          if (fresh) setChatOverlayOpen(true);
          else showToast("You're matched — open the chat from Instant Match", 'success');
        });
      }, 1600);
    });

    const offDeclined = matchSocketClient.on('match:declined', ({ reason, requeued } = {}) => {
      setActiveMatch(null);
      setBusy(false);
      inFlightRef.current = false;
      if (reason) showToast(reason);
      // The server tells us whether it put us back in the queue, so the UI
      // never has to guess which side declined.
      if (requeued) {
        setStatus('searching');
        setStep(STEP_SEARCHING);
      } else {
        setStatus('idle');
        setStep(STEP_ACTIVITY);
        setFormData(initialFormData);
        setSheetOpen(false);
      }
    });

    // The server re-queued us. It has already done the work — we only catch up.
    const offResumed = matchSocketClient.on('search:resumed', () => {
      setActiveMatch(null);
      setStatus('searching');
      setStep(STEP_SEARCHING);
    });

    setConnected(matchSocketClient.connected);
    resync();

    return () => {
      offStatus(); offStats(); offFound(); offAccepted(); offDeclined(); offResumed();
    };
  }, [currentUser?.id, queryClient, resync, refreshChat]);

  // ── Sheet ───────────────────────────────────────────────────────────────────

  const openSheet = useCallback(() => {
    setError(null);
    setSheetOpen(true);
    setStep((prev) => (statusRef.current === 'searching' ? STEP_SEARCHING : prev));
  }, []);

  const closeSheet = useCallback(() => {
    // A live match card must be answered, not dismissed — that one is a
    // decision with a countdown behind it.
    //
    // 'matched' is NOT in that set any more. It used to be a 1.6s celebration
    // that closed itself, so blocking it was harmless; now it is the state a
    // user sits in for the whole 24h chat, and this guard was leaving the
    // close button permanently dead on the matched panel.
    if (statusRef.current === 'match_found') return;
    setSheetOpen(false);
    setError(null);
    // Minimising while searching keeps the search alive — the connection is
    // held by the provider, not by the sheet.
  }, []);

  const nextStep = useCallback(() => setStep((s) => Math.min(STEP_LOCATION, s + 1)), []);
  const prevStep = useCallback(() => setStep((s) => Math.max(STEP_ACTIVITY, s - 1)), []);

  const updateFormData = useCallback((fields) => {
    setError(null);
    setFormData((prev) => ({ ...prev, ...fields }));
  }, []);

  const resetForm = useCallback(() => {
    setFormData(initialFormData);
    setStep(STEP_ACTIVITY);
    setError(null);
  }, []);

  // ── Actions ─────────────────────────────────────────────────────────────────

  const startSearch = useCallback(async () => {
    if (inFlightRef.current) return;

    const check = validateRequest(formData);
    if (!check.valid) {
      setError(check.message);
      setStep(check.step);
      return;
    }

    inFlightRef.current = true;
    setBusy(true);
    setError(null);
    // Starting a new search retires the previous pairing from the UI. The
    // chat itself lives out its 24 hours in Messages either way.
    setRecentMatch(null);
    // Optimistic: show the searching screen immediately, and roll back below
    // if the server refuses.
    setStatus('searching');
    setStep(STEP_SEARCHING);

    requestNotificationPermission();

    const res = await matchSocketClient.joinQueue({
      campus: getCollegeName(currentUser),
      activity: formData.activity,
      timePreference: formData.timePreference,
      optionalDetail: formData.optionalDetail || undefined,
      location: {
        area: formData.location.area || undefined,
        gps: formData.location.gps
          ? {
              latitude: formData.location.gps.latitude,
              longitude: formData.location.gps.longitude,
            }
          : undefined,
      },
    });

    inFlightRef.current = false;
    setBusy(false);

    if (!res.ok) {
      // Never leave someone on a searching screen the server knows nothing
      // about — that was the old silent failure.
      setStatus('idle');
      setStep(STEP_LOCATION);
      setError(res.error);
    }
  }, [formData, currentUser]);

  const cancelSearch = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setBusy(true);

    const res = await matchSocketClient.cancelQueue();

    inFlightRef.current = false;
    setBusy(false);

    if (!res.ok) {
      setError(res.error);
      showToast(res.error, 'error');
      return; // stay on the searching screen: we are still queued
    }
    setStatus('idle');
    setActiveMatch(null);
    resetForm();
  }, [resetForm]);

  const respondToMatch = useCallback(async (action) => {
    const match = activeMatch;
    if (!match || inFlightRef.current) return;
    if (statusRef.current !== 'match_found') return;

    inFlightRef.current = true;
    setBusy(true);
    setError(null);

    // Accepting is a two-party handshake — reflect the wait rather than
    // pretending the chat is already open.
    if (action === 'accept') setStatus('waiting');

    const res = await matchSocketClient.respondToMatch(match.matchId, action);

    inFlightRef.current = false;
    setBusy(false);

    if (!res.ok) {
      // The match may simply have expired under us; the server will follow up
      // with match:declined either way.
      setError(res.error);
      showToast(res.error, 'error');
      if (statusRef.current === 'waiting') setStatus('match_found');
    }
  }, [activeMatch]);

  /**
   * Our countdown emptied. We deliberately do not auto-decline: declining
   * would mark this user as the one who passed and skip their re-queue, while
   * the server's expiry sweep correctly returns *both* sides to the queue.
   */
  const handleMatchTimeout = useCallback(() => {
    setStatus((prev) => (prev === 'match_found' ? 'timed_out' : prev));
  }, []);

  const dismissError = useCallback(() => setError(null), []);

  /**
   * Jump back into the conversation the match opened.
   *
   * The chat id can legitimately be missing for a moment — the accept event
   * raced ahead of the conversation write, or this tab reconnected mid-match
   * — so an absent id asks the server for the authoritative state and routes
   * on the answer, instead of the old silent `return` that made the button
   * look broken.
   */
  const openMatchChat = useCallback(async () => {
    if (openingChatRef.current) return;

    // Opens the dedicated Instant Match surface — deliberately NOT a route
    // into /messages. This conversation does not live there, is not listed
    // there, and sending the user there would undo the separation the whole
    // feature rests on.
    if (chatRef.current?.isActive) {
      setSheetOpen(false);
      setChatOverlayOpen(true);
      return;
    }

    openingChatRef.current = true;
    setBusy(true);
    try {
      // No live chat in hand: ask the server rather than doing nothing. The
      // accept may have raced ahead of the conversation write, or this tab
      // may have reconnected mid-match.
      const fresh = await refreshChat();
      if (fresh?.isActive) {
        setSheetOpen(false);
        setChatOverlayOpen(true);
      } else if (fresh) {
        // It exists but has ended — show the ending in place, with its
        // reason, rather than a dead button or a wrong route.
        setChatOverlayOpen(true);
      } else {
        setStatus('idle');
        setRecentMatch(null);
        showToast('That chat has closed — start a new search', 'error');
      }
    } finally {
      openingChatRef.current = false;
      setBusy(false);
    }
  }, [refreshChat]);

  const closeChatOverlay = useCallback(() => setChatOverlayOpen(false), []);

  /**
   * "Find someone new".
   *
   * Ends the match on the server, then drops the user straight into the
   * matching flow — one action, not a walk back through screens. Passing
   * `alreadyEnded` skips the leave call for a chat that is already over
   * (expired, or the other person left) while taking the same path onward.
   */
  const leaveMatch = useCallback(async ({ alreadyEnded = false } = {}) => {
    if (leavingRef.current) return false;
    leavingRef.current = true;
    setLeaving(true);

    try {
      if (!alreadyEnded) {
        const res = await leaveChatSession(chatRef.current?.matchId);
        if (!res.ok) {
          showToast(res.error || 'Could not leave this match', 'error');
          return false;
        }
      }

      // Local state follows the server's, then hands over to matching.
      setChatOverlayOpen(false);
      setRecentMatch(null);
      setActiveMatch(null);
      setStatus('idle');
      setFormData(initialFormData);
      setStep(STEP_ACTIVITY);
      setSheetOpen(true);
      return true;
    } finally {
      leavingRef.current = false;
      setLeaving(false);
    }
  }, [leaveChatSession]);

  /** Clear the panel and drop the user back into a fresh search. */
  const dismissRecentMatch = useCallback(() => {
    setRecentMatch(null);
    setStatus((prev) => (prev === 'matched' ? 'idle' : prev));
    setFormData(initialFormData);
    setStep(STEP_ACTIVITY);
  }, []);

  /**
   * What the launcher should render. Derived from one place so the button can
   * never disagree with the state machine — the old FAB re-derived
   * "searching" from `status` and had no notion of the other outcomes, which
   * is how it got stuck showing a plain Match button after a real match.
   */
  const buttonState = useMemo(() => {
    if (!connected) {
      // Only surface the reconnect while something is actually at stake.
      if (status === 'searching') return 'reconnecting';
    }
    if (status === 'searching') return 'searching';
    if (status === 'match_found' || status === 'waiting' || status === 'timed_out') {
      return 'responding';
    }
    // A live 24h chat is the truest signal that this user is matched — it
    // comes from the server and survives reloads, reconnects and other tabs.
    if (chat?.isActive) return 'matched';
    if (status === 'matched' || (recentMatch && recentMatch.chatId)) return 'matched';
    // A chat that has ended still deserves its own launcher state, so the
    // user is told what happened rather than silently dropped back to idle.
    if (chat && !chat.isActive) return 'ended';
    if (error) return 'error';
    return 'idle';
  }, [status, connected, recentMatch, error, chat]);

  /**
   * The pairing outlives the celebration but not the chat. When the 24h
   * window closes, drop back to idle on our own rather than leaving a
   * "Matched" button pointing at a conversation the server has deleted.
   */
  useEffect(() => {
    const expiry = recentMatch?.expiresAt;
    if (!expiry) return undefined;
    const ms = expiry - Date.now();
    if (ms <= 0) {
      setRecentMatch(null);
      setStatus((prev) => (prev === 'matched' ? 'idle' : prev));
      return undefined;
    }
    // setTimeout saturates past ~24.8 days; a 24h window is safely inside it.
    const t = window.setTimeout(() => {
      setRecentMatch(null);
      setStatus((prev) => (prev === 'matched' ? 'idle' : prev));
    }, ms);
    return () => window.clearTimeout(t);
  }, [recentMatch?.expiresAt]);

  /**
   * The window the launcher's ring depletes over: from the moment the match
   * was made to the moment its chat closes. Null whenever there is nothing
   * counting down, so the ring is simply absent rather than sitting full.
   */
  const matchCountdown = useMemo(() => {
    // The chat session is the authority on the deadline; `recentMatch` is a
    // fallback for the moment between accepting and the chat state landing.
    const expiresAt = chat?.expiresAt ?? recentMatch?.expiresAt;
    if (!expiresAt || (chat && !chat.isActive)) return null;
    // `matchedAt` is when this client learned of the match; fall back to a
    // 24h window so a snapshot without it still produces a sane arc.
    const startedAt = chat?.createdAt ?? recentMatch?.matchedAt ?? expiresAt - 24 * 60 * 60 * 1000;
    if (!(expiresAt > startedAt)) return null;
    return { startedAt, expiresAt };
  }, [chat, recentMatch?.expiresAt, recentMatch?.matchedAt]);

  /** The other person, resolved for the chat header and the ended screens. */
  const matchPartner = useMemo(() => {
    if (recentMatch?.candidate && (!chat || recentMatch.candidate.id === chat.otherUserId)) {
      return recentMatch.candidate;
    }
    if (activeMatch?.candidate && activeMatch.candidate.id === chat?.otherUserId) {
      return activeMatch.candidate;
    }
    return recentMatch?.candidate ?? null;
  }, [recentMatch, activeMatch, chat]);

  // The countdown lives on the chat, so hand the hook's elapsed callback
  // along with it rather than making the overlay reach for both.
  const chatWithCallback = useMemo(
    () => (chat ? { ...chat, onCountdownElapsed } : null),
    [chat, onCountdownElapsed],
  );

  const value = useMemo(() => ({
    sheetOpen, step, formData, status, buttonState, matchCountdown,
    queueStats, activeMatch,
    chat: chatWithCallback, chatOverlayOpen, matchPartner, leaving,
    closeChatOverlay, leaveMatch, refreshChat,
    error, busy, connected, restoring, isBusyState, recentMatch,
    openSheet, closeSheet, nextStep, prevStep, setStep,
    updateFormData, resetForm, startSearch, cancelSearch,
    respondToMatch, handleMatchTimeout, dismissError,
    openMatchChat, dismissRecentMatch,
  }), [
    sheetOpen, step, formData, status, buttonState, matchCountdown,
    queueStats, activeMatch,
    chatWithCallback, chatOverlayOpen, matchPartner, leaving,
    closeChatOverlay, leaveMatch, refreshChat,
    error, busy, connected, restoring, isBusyState, recentMatch,
    openSheet, closeSheet, nextStep, prevStep,
    updateFormData, resetForm, startSearch, cancelSearch,
    respondToMatch, handleMatchTimeout, dismissError,
    openMatchChat, dismissRecentMatch,
  ]);

  return (
    <InstantMatchContext.Provider value={value}>
      {children}
    </InstantMatchContext.Provider>
  );
}

/** Asks once, only at the moment it becomes useful — when a search starts. */
function requestNotificationPermission() {
  try {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  } catch {
    // Unsupported or blocked by policy — matching works fine without it.
  }
}

function notifyMatchFound(match) {
  try {
    if (!document.hidden) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const name = match.candidate?.displayName || 'Someone';
    // eslint-disable-next-line no-new
    new Notification('⚡ Match found!', {
      body: `${name} is up for ${match.activity}. Tap to respond.`,
      icon: '/logo-192.png',
      tag: `instant-match-${match.matchId}`,
    });
  } catch {
    // Notifications are a nicety; never let one break the match flow.
  }
}

export function useInstantMatch() {
  const context = useContext(InstantMatchContext);
  if (!context) {
    throw new Error('useInstantMatch must be used within an InstantMatchProvider');
  }
  return context;
}
