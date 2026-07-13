import React, { createContext, useContext, useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';

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
  vibe: [],
  seeking: [],
  interests: [],
  goals: [],
  dreamCollab: '',
  discoveryPreference: '',
  crossCollege: '',
  distance: '',
  weekendActivity: '',
  role: '',
  socialEnergy: '',
  energyLevel: 50,
  signature: ''
};

export const SignupProvider = ({ children }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const urlStep = parseInt(searchParams.get('step'), 10);
  const currentStep = !isNaN(urlStep) && urlStep >= 1 && urlStep <= 11 ? urlStep : 1;

  const [signupData, setSignupData] = useState(() => {
    try {
      const saved = sessionStorage.getItem('meetifyy_signup_data');
      return saved ? JSON.parse(saved) : initialData;
    } catch (e) {
      return initialData;
    }
  });

  useEffect(() => {
    if (!searchParams.get('step')) {
      setSearchParams({ step: 1 }, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    sessionStorage.setItem('meetifyy_signup_data', JSON.stringify(signupData));
  }, [signupData]);

  const updateData = (newData) => {
    setSignupData((prev) => ({ ...prev, ...newData }));
  };

  const nextStep = () => {
    const next = Math.min(currentStep + 1, 11);
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
        nextStep,
        prevStep,
        goToStep,
        totalSteps: 11
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
