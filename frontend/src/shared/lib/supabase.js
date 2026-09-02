import { AuthClient } from '@supabase/auth-js';
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

/**
 * The auth client, built directly rather than through `createClient()`.
 *
 * Nothing in this app touches `supabase.from()`, `supabase.storage`,
 * `supabase.functions` or `supabase.channel()` — data, files and realtime all
 * go through our own backend. But `createClient()` constructs postgrest-js,
 * storage-js, functions-js and realtime-js (with its phoenix socket) eagerly in
 * the SupabaseClient constructor, so all four landed in the entry chunk and
 * were parsed on every cold start: ~300 kB of JavaScript for four clients that
 * are never called.
 *
 * `@supabase/auth-js` is what `createClient` puts behind `.auth` anyway — the
 * `SupabaseAuthClient` it instantiates is a subclass with an empty body — so
 * this is the same object with the same behaviour, minus the unused siblings.
 *
 * The options below reproduce supabase-js's defaults exactly. The storage key
 * matters most: it is how a session already in localStorage is found, so it has
 * to keep deriving from the project ref the same way, or every signed-in user
 * would be silently logged out by this change.
 */
function createAuthClient() {
  const baseUrl = new URL(supabaseUrl);
  const projectRef = baseUrl.hostname.split('.')[0];

  return new AuthClient({
    url: new URL('auth/v1', baseUrl).href,
    headers: {
      Authorization: `Bearer ${supabaseAnonKey}`,
      apikey: supabaseAnonKey,
    },
    storageKey: `sb-${projectRef}-auth-token`,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    flowType: 'implicit',
  });
}

/**
 * Shaped like the supabase-js client for the one property the app uses, so
 * every call site (`supabase.auth.getSession()`, `.onAuthStateChange`, …) is
 * unchanged.
 */
export const supabase = isSupabaseConfigured
  ? { auth: createAuthClient() }
  : null;
