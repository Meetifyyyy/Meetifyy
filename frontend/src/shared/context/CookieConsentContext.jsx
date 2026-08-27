import { createContext, useContext, useState, useCallback, useEffect } from 'react';

const CONSENT_KEY = 'meetifyy_consent';
const CONSENT_VERSION = '1.0';

const CookieConsentContext = createContext(null);

function readStoredConsent() {
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.version === CONSENT_VERSION && parsed?.acknowledgedAt) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function CookieConsentProvider({ children }) {
  const [consent, setConsent] = useState(() => readStoredConsent());
  const [preferencesOpen, setPreferencesOpen] = useState(false);

  const hasAcknowledged = !!consent;

  const acknowledge = useCallback(() => {
    const record = {
      version: CONSENT_VERSION,
      acknowledgedAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem(CONSENT_KEY, JSON.stringify(record));
    } catch {
      // Storage blocked - still dismiss the banner in memory
    }
    setConsent(record);
  }, []);

  const openPreferences = useCallback(() => setPreferencesOpen(true), []);
  const closePreferences = useCallback(() => setPreferencesOpen(false), []);

  // Also dismiss the banner when preferences modal is closed after being
  // opened without having acknowledged yet - ensures the banner won't
  // flash back after someone reads through the detail and closes it.
  const handleClosePreferences = useCallback(() => {
    closePreferences();
    if (!consent) {
      acknowledge();
    }
  }, [closePreferences, consent, acknowledge]);

  return (
    <CookieConsentContext.Provider
      value={{
        hasAcknowledged,
        acknowledge,
        openPreferences,
        closePreferences: handleClosePreferences,
        preferencesOpen,
      }}
    >
      {children}
    </CookieConsentContext.Provider>
  );
}

export function useCookieConsent() {
  const ctx = useContext(CookieConsentContext);
  if (!ctx) {
    throw new Error('useCookieConsent must be used inside <CookieConsentProvider>');
  }
  return ctx;
}
