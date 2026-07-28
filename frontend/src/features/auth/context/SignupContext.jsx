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
const SESSION_EPOCH_KEY = 'meetifyy_signup_epoch';

export const SignupProvider = ({ children }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();

  const urlStep = parseInt(searchParams.get('step'), 10);
  const currentStep = !isNaN(urlStep) && urlStep >= 1 && urlStep <= 5 ? urlStep : 1;

  const [signupData, setSignupData] = useState(() => {
    // If we're starting fresh at step 1 (no step param or step=1), clear any
    // stale sessionStorage from a previous abandoned signup attempt.
    const incomingStep = parseInt(new URLSearchParams(window.location.search).get('step'), 10);
    const isStartingFresh = isNaN(incomingStep) || incomingStep === 1;

    if (isStartingFresh) {
      // Clear stale session data so username/email from a previous attempt
      // don't pollute the availability checks in Step1 and Step2.
      sessionStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(SESSION_EPOCH_KEY);
    }

    let parsed = initialData;
    if (!isStartingFresh) {
      try {
        const saved = sessionStorage.getItem(SESSION_KEY);
        if (saved) {
          parsed = JSON.parse(saved);
        }
      } catch (e) {
        // Corrupted storage — start fresh
        sessionStorage.removeItem(SESSION_KEY);
      }
    }
    
    if (location.state && location.state.email) {
      return { ...parsed, email: location.state.email };
    }
    return parsed;
  });

  useEffect(() => {
    if (!searchParams.get('step')) {
      setSearchParams({ step: 1 }, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    // Never persist passwords — even temporarily
    const { password, ...safeData } = signupData;
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(safeData));
  }, [signupData]);

  const updateData = (newData) => {
    setSignupData((prev) => ({ ...prev, ...newData }));
  };

  const clearSignupData = () => {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_EPOCH_KEY);
    setSignupData(initialData);
  };

  const nextStep = () => {
    const next = Math.min(currentStep + 1, 5);
    setSearchParams({ step: next });
  };
  
  const prevStep = () => {
    const prev = Math.max(currentStep - 1, 1);
    setSearchParams({ step: prev });
  };
  
  const goToStep = (step) => {
    setSearchParams({ step });
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
