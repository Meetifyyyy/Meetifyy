import { createContext, useCallback, useContext, useRef, useState, useEffect } from 'react';
import { useSearchParams, useLocation } from 'react-router-dom';
import { useAuth } from '@shared/context/AuthContext';
import { SIGNUP_DEV_BYPASS } from '../signup/dev/signupDevBypass';

const SignupContext = createContext();

const initialData = {
  firstName: '',
  lastName: '',
  username: '',
  birthday: '',
  course: '',
  branch: '',
  passingYear: null,
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
const COLLEGE_KEY = 'meetifyy_signup_college';
const PENDING_KEY = 'meetifyy_signup_pending_email';
const MAX_SESSION_AGE_MS = 30 * 60 * 1000; // 30 minutes TTL

/*
 * Six steps, in the order the backend needs them:
 *   1 Say hello   name + college email   (email gate: approved college domain)
 *   2 Profile     username + birthday
 *   3 College     course, branch, year   (the college itself comes from the email)
 *   4 Password    password + consent     → POST /signup, which sends the code
 *   5 Verify      emailed code           → signed in, profile synced
 *   6 Photo       optional avatar        → completeSignup
 * Everything the account needs is collected before step 4 creates it.
 */
export const TOTAL_SIGNUP_STEPS = 6;

/**
 * The first step whose inputs are still missing, given what has been saved.
 * A reload or a hand-edited `?step=` never lands past it.
 */
function firstIncompleteStep(data) {
  if (!data.firstName || !data.email) return 1;
  if (!data.username || !data.birthday) return 2;
  if (!data.course || !data.branch || !Number.isInteger(data.passingYear)) return 3;
  return TOTAL_SIGNUP_STEPS;
}

/**
 * Whether a signup is part-way through in this tab.
 *
 * The last step runs AFTER the OTP has been verified, so the user is already
 * authenticated while still inside the flow. `PublicRoute` would otherwise send
 * them to /home the moment they signed in and strand the signup at step 5, so
 * it asks this before redirecting.
 *
 * Keyed on the step marker the flow itself writes and `clearSignupData` removes,
 * so "in progress" is the flow's own state rather than a flag maintained
 * somewhere else that can disagree with it.
 */
export function isSignupInProgress() {
  try {
    return sessionStorage.getItem(STEP_KEY) !== null;
  } catch {
    // Storage blocked. Treating it as "not in progress" only means a signed-in
    // visitor to /signup is sent home, which is the behaviour for everyone who
    // is not mid-flow anyway.
    return false;
  }
}

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
    : (!isNaN(urlStep) && urlStep >= 1 && urlStep <= TOTAL_SIGNUP_STEPS
        ? urlStep
        : (savedStep && savedStep >= 1 && savedStep <= TOTAL_SIGNUP_STEPS ? savedStep : 1));

  // Shown on the College step; derived from the email, never sent anywhere.
  // Kept out of `signupData` because that object is posted to sync-profile.
  const [collegeName, setCollegeNameState] = useState(() => {
    try { return sessionStorage.getItem(COLLEGE_KEY) || ''; } catch { return ''; }
  });
  const setCollegeName = useCallback((name) => {
    setCollegeNameState(name || '');
    try {
      if (name) sessionStorage.setItem(COLLEGE_KEY, name);
      else sessionStorage.removeItem(COLLEGE_KEY);
    } catch { /* storage blocked: the label is cosmetic */ }
  }, []);

  /*
   * The address a code has already been sent to, if any.
   *
   * POST /signup refuses a second signup for an address still waiting on its
   * code ("A signup is already pending"), so going back from the verify step
   * and returning with the same address used to dead-end on the password
   * step, with a valid code sitting in the inbox. Knowing the address lets the
   * password step skip the second call and go straight back to code entry.
   *
   * The password it was created with is held in memory only (a ref, never
   * storage): if it changed, the pending account still has the old one, so
   * the password step has to know. After a reload it is simply unknown.
   */
  const [pendingEmail, setPendingEmailState] = useState(() => {
    try { return sessionStorage.getItem(PENDING_KEY) || ''; } catch { return ''; }
  });
  const pendingPasswordRef = useRef(null);
  const markCodeSent = useCallback((email, password) => {
    setPendingEmailState(email);
    pendingPasswordRef.current = password;
    try { sessionStorage.setItem(PENDING_KEY, email); } catch { /* cosmetic */ }
  }, []);

  // True while the finishing screen runs after the last step.
  const [finishing, setFinishing] = useState(false);

  const [signupData, setSignupData] = useState(() => {
    // If starting on step 1 or fresh entry, always clear any old draft data
    const stepInUrl = parseInt(searchParams.get('step'), 10);
    if (!stepInUrl || stepInUrl === 1 || isFreshIntent) {
      sessionStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(STEP_KEY);
      sessionStorage.removeItem(TIMESTAMP_KEY);
      sessionStorage.removeItem(COLLEGE_KEY);
      sessionStorage.removeItem(PENDING_KEY);
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

        const rawYear = decoded.passingYear ?? decoded.currentYear;
        if (typeof rawYear === 'string') {
          parsed.passingYear = /^\d+$/.test(rawYear) ? parseInt(rawYear, 10) : null;
        } else if (Number.isInteger(rawYear)) {
          parsed.passingYear = rawYear;
        } else {
          parsed.passingYear = null;
        }

        if (!parsed.course) {
          parsed.branch = '';
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
      if (currentStep < TOTAL_SIGNUP_STEPS) {
        setSearchParams({ step: TOTAL_SIGNUP_STEPS }, { replace: true });
      }
      return;
    }

    // TEMPORARY: local review of the step UI (never true in a production build).
    if (SIGNUP_DEV_BYPASS) return;

    // Each step needs everything before it. Step 6 is post-auth only, so a
    // signed-out visitor never gets past step 5.
    const allowed = Math.min(firstIncompleteStep(signupData), TOTAL_SIGNUP_STEPS - 1);
    if (currentStep > allowed) {
      setSearchParams({ step: allowed }, { replace: true });
    }
  }, [currentStep, signupData, isLoggedIn, setSearchParams]);

  const updateData = (newData) => {
    setSignupData((prev) => ({ ...prev, ...newData }));
  };

  const clearSignupData = () => {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(STEP_KEY);
    sessionStorage.removeItem(TIMESTAMP_KEY);
    sessionStorage.removeItem(COLLEGE_KEY);
    sessionStorage.removeItem(PENDING_KEY);
    setSignupData(initialData);
  };

  const nextStep = () => {
    const next = Math.min(currentStep + 1, TOTAL_SIGNUP_STEPS);
    setSearchParams({ step: next });
    sessionStorage.setItem(STEP_KEY, String(next));
  };
  
  const prevStep = () => {
    const prev = Math.max(currentStep - 1, 1);
    setSearchParams({ step: prev });
    sessionStorage.setItem(STEP_KEY, String(prev));
  };
  
  const goToStep = (step) => {
    const valid = Math.max(1, Math.min(step, TOTAL_SIGNUP_STEPS));
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
        totalSteps: TOTAL_SIGNUP_STEPS,
        collegeName,
        setCollegeName,
        finishing,
        setFinishing,
        pendingEmail,
        pendingPasswordRef,
        markCodeSent,
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
