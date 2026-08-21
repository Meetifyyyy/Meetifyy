import { create } from 'zustand';

/**
 * devToolsStore — opt-in switches for development-only surfaces.
 *
 * These are persisted (unlike uiStore's transient state) so the choice survives
 * a reload, but they are only ever read behind `import.meta.env.DEV`, so none of
 * this reaches a production build.
 *
 * The Notification Lab used to mount its floating button unconditionally in dev.
 * It is fixed above everything at the bottom-right, so it sat on top of real
 * controls -- the chat Send button among them -- and had to be worked around
 * rather than used. It now defaults to off and is enabled from Settings.
 */
const STORAGE_KEY = 'devTools.notificationLab';

function readInitial() {
  // Never read storage in a production build: the toggle UI and the lab mount are
  // both behind import.meta.env.DEV, so the flag can only ever be false there.
  // This keeps production from doing a pointless localStorage hit at boot.
  if (!import.meta.env.DEV) return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    // private mode / storage disabled — fall back to off
    return false;
  }
}

const useDevToolsStore = create((set) => ({
  notificationLabEnabled: readInitial(),

  setNotificationLabEnabled: (enabled) => {
    try {
      localStorage.setItem(STORAGE_KEY, String(enabled));
    } catch {
      /* ignore — the toggle still works for this session */
    }
    set({ notificationLabEnabled: enabled });
  },
}));

export default useDevToolsStore;
