/**
 * The provider (Supabase) auth client for the installed app, loaded on first use.
 *
 * The mobile build resolves `@shared/lib/supabase` to this file (see
 * vite.mobile.config.js). The real module statically imports
 * `@supabase/auth-js` — 98 KB, and the package declares no `sideEffects`, so a
 * bundler must keep it wherever it is imported — which put it in the entry
 * chunk the app parses before it can do anything at launch. The app only needs
 * it to finish signup (`verifyOtp`) and for a local sign-out: its session is
 * the API's, held in the Keystore, never the provider's.
 *
 * Same exports, same shapes. Async methods load the client, then call it.
 * `onAuthStateChange` keeps its synchronous contract: the subscription handle
 * comes back at once and attaches when the client arrives. Once loaded, every
 * call goes straight to the real client. The website build is unaffected.
 */
import { config } from '@config';

const { url: supabaseUrl } = config.supabase;

export const isSupabaseConfigured = !!supabaseUrl && !supabaseUrl.includes('placeholder');

let real = null;
let loading = null;

/** Loads the real module once. Exported for tests and for an early warm-up. */
export function loadSupabase() {
  loading ??= import('../shared/lib/supabase.js')
    .then((m) => {
      real = m;
      return m;
    })
    .catch((err) => {
      loading = null; // a later call may retry a chunk that failed to load
      throw err;
    });
  return loading;
}

const later = (method) => async (...args) => {
  const m = await loadSupabase();
  return m.supabase.auth[method](...args);
};

const lazyAuth = {
  verifyOtp: later('verifyOtp'),
  signOut: later('signOut'),
  getSession: later('getSession'),
  updateUser: later('updateUser'),
  onAuthStateChange(callback) {
    let subscription = null;
    let cancelled = false;
    loadSupabase()
      .then((m) => {
        if (cancelled) return;
        subscription = m.supabase.auth.onAuthStateChange(callback)?.data?.subscription ?? null;
      })
      .catch(() => {});
    return {
      data: {
        subscription: {
          unsubscribe() {
            cancelled = true;
            subscription?.unsubscribe?.();
          },
        },
      },
    };
  },
};

export const supabase = isSupabaseConfigured
  ? {
      get auth() {
        return real?.supabase ? real.supabase.auth : lazyAuth;
      },
    }
  : null;

// The app never receives password-recovery links (they open in the browser);
// once the real module has loaded, its own answer is used.
export const isRecoveryTab = () => (real ? real.isRecoveryTab() : false);
export const clearRecoveryTab = () => real?.clearRecoveryTab();

/** Nothing to forget if the client never loaded: it held no session. */
export function forgetProviderSession() {
  real?.forgetProviderSession();
}
