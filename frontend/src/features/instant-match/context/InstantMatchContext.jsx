import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, supabase } from '@shared/context/AuthContext';
import { getCollegeName } from '@shared/utils/user';
import { showToast } from '@shared/utils/toast';

import matchSocketClient from '../utils/matchSocketClient';
import { useMessageActions } from '@shared/hooks/useMessageActions';


const InstantMatchContext = createContext(null);

const initialFormData = {
  activity: '',
  timePreference: '',
  optionalDetail: '',
  location: {
    area: '',
    gps: null
  }
};

export function InstantMatchProvider({ children }) {
  const { currentUser } = useAuth();
  const { start24HrInstantChat } = useMessageActions();
  const navigate = useNavigate();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState(initialFormData);
  
  // States: 'idle' | 'searching' | 'match_found' | 'chat_redirect'
  const [status, setStatus] = useState('idle');
  const [queueStats, setQueueStats] = useState({ count: 0, avgWaitSecs: 120 });
  const [activeMatch, setActiveMatch] = useState(null);

  const activeMatchRef = useRef(activeMatch);
  useEffect(() => {
    activeMatchRef.current = activeMatch;
  }, [activeMatch]);

  // Tracks whether the local user was the one who declined, so the
  // match:declined handler can tell "I declined" apart from "I got declined".
  const selfDeclinedRef = useRef(false);
  // Always points at the latest startSearch so search:resumed can re-join
  // the queue without forcing the socket-subscription effect to re-run.
  const startSearchRef = useRef(null);

  // Connect only when the sheet opens — no second socket running in the background.
  useEffect(() => {
    if (!sheetOpen || !currentUser?.id) return;

    supabase?.auth.getSession().then(({ data: { session } }) => {
      matchSocketClient.connect(session?.access_token || null, currentUser);
    });

    return () => {
      matchSocketClient.disconnect();
    };
  }, [sheetOpen, currentUser?.id]);

  // Subscribe to real-time events
  useEffect(() => {
    matchSocketClient.on('queue:stats', (stats) => {
      setQueueStats(stats);
    });

    matchSocketClient.on('match:found', (match) => {
      setActiveMatch(match);
      setStatus('match_found');

      // Send local push notification if backgrounded
      if (document.hidden && Notification.permission === 'granted') {
        new Notification('⚡ Match Found!', {
          body: `We found a study/hangout partner for you!`,
          icon: '/logo-192.png'
        });
      }
    });

    matchSocketClient.on('match:accepted', async () => {
      setStatus('chat_redirect');
      setSheetOpen(false);

      const currentMatch = activeMatchRef.current;
      let targetChatId = null;
      if (currentMatch && currentMatch.candidate) {
        targetChatId = await start24HrInstantChat(currentMatch.candidate, currentMatch.activity);
      }

      // Wait for a brief celebration/animation before redirect
      setTimeout(() => {
        setStatus('idle');
        setFormData(initialFormData);
        setStep(1);
        setActiveMatch(null);
        if (targetChatId) {
          navigate(`/messages/${targetChatId}`, { state: { from: '/home' } });
        } else {
          // Chat creation failed server-side — don't send the user to a broken route.
          showToast("You're matched", 'success');
          navigate('/messages', { state: { from: '/home' } });
        }
      }, 1500);
    });

    matchSocketClient.on('match:declined', ({ reason } = {}) => {
      setActiveMatch(null);
      if (reason) showToast(reason);

      if (selfDeclinedRef.current) {
        // We declined: nothing left to wait on, return to idle.
        selfDeclinedRef.current = false;
        setSheetOpen(false);
        setStatus('idle');
        setStep(1);
        setFormData(initialFormData);
      } else {
        // The other student declined/was unavailable — a search:resumed
        // event will follow shortly and put us back into 'searching'.
        setStatus('idle');
      }
    });

    matchSocketClient.on('search:resumed', () => {
      setStatus('searching');
      setActiveMatch(null);
      // Backend removed us from the queue when we were matched; rejoin now.
      startSearchRef.current?.();
    });

    return () => {
      matchSocketClient.off('queue:stats');
      matchSocketClient.off('match:found');
      matchSocketClient.off('match:accepted');
      matchSocketClient.off('match:declined');
      matchSocketClient.off('search:resumed');
    };
  }, [navigate, start24HrInstantChat]);

  const openSheet = useCallback(() => {
    setSheetOpen(true);
    if (status !== 'searching') {
      setStep(1);
      setFormData(initialFormData);
      setStatus('idle');
    }
  }, [status]);

  const closeSheet = useCallback(() => {
    if (status === 'match_found' || status === 'chat_redirect') return;
    if (status === 'searching') {
      setSheetOpen(false);
    } else {
      setSheetOpen(false);
      setStatus('idle');
    }
  }, [status]);

  const nextStep = useCallback(() => {
    setStep(prev => prev + 1);
  }, []);

  const prevStep = useCallback(() => {
    setStep(prev => Math.max(1, prev - 1));
  }, []);

  const updateFormData = useCallback((fields) => {
    setFormData(prev => ({
      ...prev,
      ...fields
    }));
  }, []);

  const startSearch = useCallback(() => {
    if (!formData.activity || !formData.timePreference) return;

    setStatus('searching');
    setStep(5); // Transition to searching layout screen

    // Standardize request format
    const request = {
      userId: currentUser?.id,
      campus: getCollegeName(currentUser),
      activity: formData.activity,
      timePreference: formData.timePreference,
      optionalDetail: formData.optionalDetail,
      location: {
        area: formData.location.area || undefined,
        gps: formData.location.gps || undefined
      },
      clientTimestamp: new Date().toISOString()
    };

    matchSocketClient.joinQueue(request);
  }, [formData, currentUser]);

  useEffect(() => {
    startSearchRef.current = startSearch;
  }, [startSearch]);

  const cancelSearch = useCallback(() => {
    matchSocketClient.cancelQueue();
    setStatus('idle');
    setStep(1);
    setFormData(initialFormData);
  }, []);

  const respondToMatch = useCallback((action) => {
    if (!activeMatch) return;
    if (action === 'decline') selfDeclinedRef.current = true;
    matchSocketClient.respondToMatch(activeMatch.matchId, action);
  }, [activeMatch]);

  const requestNotificationPermission = useCallback(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  return (
    <InstantMatchContext.Provider
      value={{
        sheetOpen,
        step,
        formData,
        status,
        queueStats,
        activeMatch,
        openSheet,
        closeSheet,
        nextStep,
        prevStep,
        setStep,
        updateFormData,
        startSearch,
        cancelSearch,
        respondToMatch,
        requestNotificationPermission
      }}
    >
      {children}
    </InstantMatchContext.Provider>
  );
}

export function useInstantMatch() {
  const context = useContext(InstantMatchContext);
  if (!context) {
    throw new Error('useInstantMatch must be used within an InstantMatchProvider');
  }
  return context;
}
