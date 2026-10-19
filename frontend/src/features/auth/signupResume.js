/**
 * A short-lived, non-sensitive copy of a signup in progress, for the one case
 * the in-memory and per-tab state cannot cover: Android killing the app while
 * it is in the background (reading the Terms in the browser, fetching the code
 * from the mail app) so that it starts cold on return.
 *
 * WHAT IS KEPT: the step and the form fields (names, email, username, birthday,
 * gender, course, branch, year, avatar choice) and which email a code went to.
 * WHAT IS NEVER KEPT: the password or its confirmation, tokens, the code. The
 * person types the password again; a password manager fills it.
 *
 * WHEN: written only as the app goes to the background mid-signup, never per
 * keystroke. Valid for 30 minutes (the same as the tab-level draft). Read once
 * and removed when the app reopens, and removed on completion, cancel, sign-in,
 * sign-out, a fresh start, or expiry. It is only offered to a signed-out app,
 * so it cannot surface inside another account's session.
 */
export const RESUME_KEY = 'meetifyy_signup_resume_v1';
export const RESUME_TTL_MS = 30 * 60 * 1000;

const SENSITIVE = ['password', 'confirmPassword', 'token', 'code', 'otp'];

function safeStorage(store) {
  if (store) return store;
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

export function saveSignupResume({ step, data, pendingEmail }, { store, now = Date.now() } = {}) {
  const s = safeStorage(store);
  if (!s || !Number.isInteger(step) || step < 1) return false;
  const clean = {};
  for (const [k, v] of Object.entries(data || {})) if (!SENSITIVE.includes(k)) clean[k] = v;
  try {
    s.setItem(RESUME_KEY, JSON.stringify({ v: 1, savedAt: now, step, data: clean, pendingEmail: pendingEmail || '' }));
    return true;
  } catch { return false; }
}

export function clearSignupResume({ store } = {}) {
  try { safeStorage(store)?.removeItem(RESUME_KEY); } catch { /* nothing to clear */ }
}

/** The saved signup if it is fresh and well formed; removed either way. */
export function takeSignupResume({ store, now = Date.now() } = {}) {
  const s = safeStorage(store);
  if (!s) return null;
  let raw = null;
  try { raw = s.getItem(RESUME_KEY); } catch { return null; }
  clearSignupResume({ store: s });
  if (!raw) return null;
  try {
    const rec = JSON.parse(raw);
    if (rec?.v !== 1 || !Number.isInteger(rec.step) || rec.step < 1 || rec.step > 5) return null;
    if (!(now - rec.savedAt >= 0) || now - rec.savedAt > RESUME_TTL_MS) return null;
    const data = {};
    for (const [k, v] of Object.entries(rec.data || {})) if (!SENSITIVE.includes(k)) data[k] = v;
    return { step: rec.step, data, pendingEmail: typeof rec.pendingEmail === 'string' ? rec.pendingEmail : '' };
  } catch { return null; }
}
