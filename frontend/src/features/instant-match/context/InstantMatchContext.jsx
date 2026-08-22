import {
  createContext, useContext, useState, useEffect, useCallback, useRef, useMemo,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@shared/context/AuthContext';
import { getCollegeName } from '@shared/utils/user';
import { showToast } from '@shared/utils/toast';

import matchSocketClient from '../utils/matchSocketClient';
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

const initialStats = { count: 0, avgWaitSecs: 0 };

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
  const navigate = useNavigate();
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

  const statusRef = useRef(status);
  statusRef.current = status;

  // Guards a second submit while the first is still in flight, closing the
  // double-tap window that a `busy` state alone leaves open across renders.
  const inFlightRef = useRef(false);

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
      setActiveMatch(state.pendingMatch);
      setStatus('match_found');
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
    // Server says we are not queued. Don't leave a stale searching screen up.
    setStatus((prev) => (prev === 'searching' || prev === 'timed_out' ? 'idle' : prev));
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

    const offAccepted = matchSocketClient.on('match:accepted', ({ chatId } = {}) => {
      setStatus('matched');
      setSheetOpen(false);

      // Capture the pairing now — activeMatch is cleared moments later, and
      // this is what the "Matched" panel renders when the user comes back.
      setActiveMatch((current) => {
        if (current?.candidate) {
          setRecentMatch({
            matchId: current.matchId,
            candidate: current.candidate,
            activity: current.activity,
            chatId: chatId ?? null,
            matchedAt: Date.now(),
          });
        }
        return current;
      });

      // The conversation list has a new chat in it now.
      queryClient.invalidateQueries({ queryKey: ['conversations'] });

      // Hold the celebration briefly, then hand over to the chat.
      window.setTimeout(() => {
        setStatus('idle');
        setActiveMatch(null);
        setFormData(initialFormData);
        setStep(STEP_ACTIVITY);
        if (chatId) {
          navigate(`/messages/${chatId}`, { state: { from: '/home' } });
        } else {
          // The server accepted the match but gave us nowhere to go. Send the
          // user somewhere real rather than to a broken route.
          showToast("You're matched — find them in your messages", 'success');
          navigate('/messages', { state: { from: '/home' } });
        }
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
  }, [currentUser?.id, navigate, queryClient, resync]);

  // ── Sheet ───────────────────────────────────────────────────────────────────

  const openSheet = useCallback(() => {
    setError(null);
    setSheetOpen(true);
    setStep((prev) => (statusRef.current === 'searching' ? STEP_SEARCHING : prev));
  }, []);

  const closeSheet = useCallback(() => {
    // A live match must be answered, not dismissed.
    if (statusRef.current === 'match_found' || statusRef.current === 'matched') return;
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

  /** Jump back into the conversation the match opened. */
  const openMatchChat = useCallback(() => {
    if (!recentMatch?.chatId) return;
    setSheetOpen(false);
    navigate(`/messages/${recentMatch.chatId}`, { state: { from: '/home' } });
  }, [recentMatch, navigate]);

  /** Clear the panel and drop the user back into a fresh search. */
  const dismissRecentMatch = useCallback(() => {
    setRecentMatch(null);
    setFormData(initialFormData);
    setStep(STEP_ACTIVITY);
  }, []);

  const value = useMemo(() => ({
    sheetOpen, step, formData, status, queueStats, activeMatch,
    error, busy, connected, restoring, isBusyState, recentMatch,
    openSheet, closeSheet, nextStep, prevStep, setStep,
    updateFormData, resetForm, startSearch, cancelSearch,
    respondToMatch, handleMatchTimeout, dismissError,
    openMatchChat, dismissRecentMatch,
  }), [
    sheetOpen, step, formData, status, queueStats, activeMatch,
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
