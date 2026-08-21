import React, { createContext, useContext, useState, useEffect } from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@shared/context/AuthContext';

// ─── DEV BYPASS ────────────────────────────────────────────────────────────────
// Set to true to skip all signup validation and API calls (dev/design mode).
// Set back to false before shipping.
export const DEV_BYPASS_SIGNUP = false;
// ───────────────────────────────────────────────────────────────────────────────

const SignupContext = createContext();

const initialData = {
  firstName: '',
  lastName: '',
  username: '',
  birthday: '',
  university: '',
  course: '',
  branch: '',
  currentYear: null,
  email: '',
  password: '',
  avatar: '',
  interests: [],
};

// Generate a session key tied to this signup attempt. This prevents stale data
// from a previous abandoned signup from leaking into a new one. The key is
// stored in sessionStorage alongside the data so it can be validated on restore.
const SESSION_KEY = 'meetifyy_signup_data';
const STEP_KEY = 'meetifyy_signup_step';
const TIMESTAMP_KEY = 'meetifyy_signup_time';
const MAX_SESSION_AGE_MS = 30 * 60 * 1000; // 30 minutes TTL

export const SignupProvider = ({ children }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const { isLoggedIn } = useAuth();

  // Handle fresh signup intent from navigation (e.g. state.fresh = true or ?fresh=true)
  const isFreshIntent = location.state?.fresh === true || searchParams.get('fresh') === 'true';

  // Restore saved step if URL step is omitted
  const urlStep = parseInt(searchParams.get('step'), 10);
  const savedStepStr = sessionStorage.getItem(STEP_KEY);
  const savedStep = savedStepStr ? parseInt(savedStepStr, 10) : null;

  const currentStep = isFreshIntent || !urlStep || urlStep === 1
    ? 1
    : (!isNaN(urlStep) && urlStep >= 1 && urlStep <= 5
        ? urlStep
        : (savedStep && savedStep >= 1 && savedStep <= 5 ? savedStep : 1));

  const [signupData, setSignupData] = useState(() => {
    // If starting on step 1 or fresh entry, always clear any old draft data
    const stepInUrl = parseInt(searchParams.get('step'), 10);
    if (!stepInUrl || stepInUrl === 1 || isFreshIntent) {
      sessionStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(STEP_KEY);
      sessionStorage.removeItem(TIMESTAMP_KEY);
      let freshData = { ...initialData };
      if (location.state && location.state.email) {
        freshData.email = location.state.email;
      }
      return freshData;
    }

    // Check for stale session expiry (30 mins TTL)
    const savedTime = sessionStorage.getItem(TIMESTAMP_KEY);
    if (savedTime) {
      const age = Date.now() - parseInt(savedTime, 10);
      if (isNaN(age) || age > MAX_SESSION_AGE_MS) {
        // Session expired — purge stale draft
        sessionStorage.removeItem(SESSION_KEY);
        sessionStorage.removeItem(STEP_KEY);
        sessionStorage.removeItem(TIMESTAMP_KEY);
        return { ...initialData };
      }
    }

    let parsed = { ...initialData };
    try {
      const saved = sessionStorage.getItem(SESSION_KEY);
      if (saved) {
        const decoded = JSON.parse(saved);
        parsed = { ...initialData, ...decoded };

        // Drop academic state written by the old Major / Year-of-Pass signup.
        // Those keys carried a free-text major and a passing year, neither of
        // which is a valid Course/Branch/Current Year, so restoring them would
        // repopulate the form with values the server now rejects.
        if ('major' in decoded || 'year' in decoded || 'yearOfPass' in decoded) {
          delete parsed.major;
          delete parsed.year;
          delete parsed.yearOfPass;
          parsed.course = '';
          parsed.branch = '';
          parsed.currentYear = null;
          if (import.meta.env.DEV) {
            console.info('[signup] cleared legacy Major/Year-of-Pass draft state on restore');
          }
        }

        // currentYear must survive JSON round-tripping as a number; a stale
        // string would fail Number.isInteger checks downstream and silently
        // render the Year dropdown empty.
        if (typeof parsed.currentYear === 'string') {
          parsed.currentYear = /^\d+$/.test(parsed.currentYear) ? parseInt(parsed.currentYear, 10) : null;
        } else if (!Number.isInteger(parsed.currentYear)) {
          parsed.currentYear = null;
        }

        // A course without a branch (or a branch without a course) is never a
        // valid resume point. AcademicSelection re-checks the pair against the
        // live catalogue once it loads; this only removes the impossible states
        // that don't need the catalogue to detect.
        if (!parsed.course) {
          parsed.branch = '';
          parsed.currentYear = null;
        }
      }
    } catch (e) {
      sessionStorage.removeItem(SESSION_KEY);
    }
    
    if (location.state && location.state.email) {
      return { ...parsed, email: location.state.email };
    }
    return parsed;
  });

  // Keep step parameter synced in URL & sessionStorage
  useEffect(() => {
    const stepInUrl = parseInt(searchParams.get('step'), 10);
    if (isNaN(stepInUrl) || stepInUrl !== currentStep) {
      setSearchParams({ step: currentStep }, { replace: true });
    }
    sessionStorage.setItem(STEP_KEY, String(currentStep));
  }, [currentStep, searchParams, setSearchParams]);

  // Persist signup data on change (passwords are omitted) and bump timestamp
  useEffect(() => {
    const { password, ...safeData } = signupData;
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(safeData));
    sessionStorage.setItem(TIMESTAMP_KEY, String(Date.now()));
  }, [signupData]);

  // Navigation guards.
  //
  // Once the user is authenticated (OTP verified at step 4 creates a Supabase
  // session), steps 1–4 are "consumed": re-entering them via browser-back, the
  // in-app back arrow, or a reload would let the user re-run signUp or replay a
  // used OTP — all broken states. So the moment we're logged in, the only valid
  // signup step is the avatar step (5); force it and replace history so back
  // can't return to a consumed step.
  //
  // Pre-auth, keep the original refresh guards that prevent jumping ahead of the
  // data that's been filled in. Step 1 produces `username`; steps 3–4 need email.
  useEffect(() => {
    if (isLoggedIn) {
      if (currentStep < 5) {
        setSearchParams({ step: 5 }, { replace: true });
      }
      return;
    }

    if (currentStep === 2 && (!signupData.username || !signupData.birthday)) {
      setSearchParams({ step: 1 }, { replace: true });
    } else if ((currentStep === 3 || currentStep === 4) && !signupData.email) {
      setSearchParams({ step: 2 }, { replace: true });
    }
  }, [currentStep, signupData, isLoggedIn, setSearchParams]);

  const updateData = (newData) => {
    setSignupData((prev) => ({ ...prev, ...newData }));
  };

  const clearSignupData = () => {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(STEP_KEY);
    sessionStorage.removeItem(TIMESTAMP_KEY);
    setSignupData(initialData);
  };

  const nextStep = () => {
    const next = Math.min(currentStep + 1, 5);
    setSearchParams({ step: next });
    sessionStorage.setItem(STEP_KEY, String(next));
  };
  
  const prevStep = () => {
    const prev = Math.max(currentStep - 1, 1);
    setSearchParams({ step: prev });
    sessionStorage.setItem(STEP_KEY, String(prev));
  };
  
  const goToStep = (step) => {
    const valid = Math.max(1, Math.min(step, 5));
    setSearchParams({ step: valid });
    sessionStorage.setItem(STEP_KEY, String(valid));
  };

  return (
    <SignupContext.Provider
      value={{
        currentStep,
        signupData,
        updateData,
        clearSignupData,
        nextStep,
        prevStep,
        goToStep,
        totalSteps: 5,
      }}
    >
      {children}
    </SignupContext.Provider>
  );
};

export const useSignup = () => {
  const context = useContext(SignupContext);
  if (!context) {
    throw new Error('useSignup must be used within a SignupProvider');
  }
  return context;
};
