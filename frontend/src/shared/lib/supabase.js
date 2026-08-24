import { createClient } from '@supabase/supabase-js';
import { config } from '@config';

const { url: supabaseUrl, anonKey: supabaseAnonKey } = config.supabase;

export const isSupabaseConfigured = !!supabaseUrl && !supabaseUrl.includes('placeholder');

// ─── Capture recovery context BEFORE createClient() clears the URL hash ──────
//
// Supabase's createClient() calls detectSessionFromUrl() internally. It parses
// the #access_token hash fragment and — after async token exchange — removes it
// from the URL via history.replaceState(). By the time any React component
// mounts, the hash may already be gone.
//
// This block runs at module-evaluation time (synchronously, before createClient)
// and writes a sessionStorage flag if the current URL is a recovery link. This
// flag is read by AuthContext and ResetPasswordPage to:
//   • Prevent AuthContext from leaking the temporary recovery session into
//     global auth state (which would make isLoggedIn = true for the whole app).
//   • Allow ResetPasswordPage to accept the session from getSession() only when
//     it is legitimately from a recovery link, not from a prior login session.
//
// sessionStorage is per-tab, so opening the same link in multiple tabs is safe.
// The flag is deleted by ResetPasswordPage once the validation is resolved.
//
if (typeof window !== 'undefined') {
  try {
    if (window.location.hash.includes('type=recovery')) {
      sessionStorage.setItem('sb-pwreset-pending', '1');
    }
    // If Supabase redirected to the reset page with an error hash (expired /
    // invalid / already-used link), capture it now — before createClient() clears
    // the hash — so ResetPasswordPage can show the "expired" state instantly
    // instead of waiting out the validation timeout.
    if (
      window.location.pathname.includes('reset-password') &&
      (window.location.hash.includes('error=') || window.location.hash.includes('error_code='))
    ) {
      sessionStorage.setItem('sb-pwreset-error', '1');
    }
  } catch {
    // sessionStorage may be blocked in some private-browsing / cross-site
    // environments. This is non-fatal — the onAuthStateChange PASSWORD_RECOVERY
    // event alone is sufficient to validate in those environments.
  }
}

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;
