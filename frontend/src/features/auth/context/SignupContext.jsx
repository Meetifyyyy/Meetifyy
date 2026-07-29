import React, { createContext, useContext, useState, useEffect } from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';

const SignupContext = createContext();

const initialData = {
  firstName: '',
  lastName: '',
  username: '',
  birthday: '',
  university: '',
  course: '',
  branch: '',
  year: '',
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

  // Handle fresh signup intent from navigation (e.g. state.fresh = true or ?fresh=true)
  const isFreshIntent = location.state?.fresh === true || searchParams.get('fresh') === 'true';

  // Restore saved step if URL step is omitted
  const urlStep = parseInt(searchParams.get('step'), 10);
  const savedStepStr = sessionStorage.getItem(STEP_KEY);
  const savedStep = savedStepStr ? parseInt(savedStepStr, 10) : null;

  const currentStep = isFreshIntent
    ? 1
    : (!isNaN(urlStep) && urlStep >= 1 && urlStep <= 5
        ? urlStep
        : (savedStep && savedStep >= 1 && savedStep <= 5 ? savedStep : 1));

  const [signupData, setSignupData] = useState(() => {
    if (isFreshIntent) {
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

  // Step safety guards: prevent jumping ahead if prerequisite data is missing on refresh
  useEffect(() => {
    if (currentStep === 2 && !signupData.name && !signupData.username) {
      setSearchParams({ step: 1 }, { replace: true });
    } else if ((currentStep === 3 || currentStep === 4) && !signupData.email) {
      setSearchParams({ step: 2 }, { replace: true });
    }
  }, [currentStep, signupData, setSearchParams]);

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
        totalSteps: 5
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
