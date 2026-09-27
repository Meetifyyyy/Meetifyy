import { preloadableLazy } from '@shared/utils/preloadableLazy';

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
