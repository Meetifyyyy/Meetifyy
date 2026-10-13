import { preloadableLazy } from '@shared/utils/preloadableLazy';
import authBg from '@assets/images/auth_bg.webp';
import proofCards from '@assets/images/auth_proof_cards.webp';

/**
 * The signed-out screens, shared by the router (App.jsx) and by the screens
 * that lead into them, so those can load them ahead of the tap.
 */
export const AuthShell = preloadableLazy(() => import('../shared/ui/AuthShell'));
export const LoginPage = preloadableLazy(() => import('../pages/LoginPage'));
export const SignupPage = preloadableLazy(() => import('../pages/SignupPage'));

/** Loads the shell and both entry screens; resolves when all three are ready. */
export function preloadAuthScreens() {
  return Promise.all([AuthShell.preload(), LoginPage.preload(), SignupPage.preload()]);
}

let warmed = null;

/**
 * Everything the login and signup screens need before their first frame: the
 * three route chunks, plus the shell's background and (wide screens) its proof
 * image, decoded so the screen does not paint them in afterwards.
 *
 * Idempotent: the landing page calls it when idle and again on hover or touch
 * of any auth link; only the first call does any work.
 */
export function warmAuthScreens() {
  if (warmed) return warmed;
  const images = [authBg];
  if (typeof window !== 'undefined' && window.matchMedia?.('(min-width: 1024px)').matches) {
    images.push(proofCards);
  }
  warmed = Promise.all([
    preloadAuthScreens(),
    ...images.map((src) => {
      const img = new Image();
      img.src = src;
      return img.decode?.().catch(() => {}) ?? Promise.resolve();
    }),
  ]).catch(() => {
    // A failed chunk fetch is retried on the real navigation; let a later
    // hover try again too.
    warmed = null;
  });
  return warmed;
}
