import { IS_MOBILE_BUILD } from '@config';

/**
 * The platform's `PushService` (platform/contracts.ts), loaded lazily.
 *
 * `import()` rather than a static import on purpose: the Capacitor
 * implementation registers native plugins at module scope, and a side-effect
 * import survives tree-shaking even when its branch folds away (AGENTS.md 6d).
 * With IS_MOBILE_BUILD a literal, each bundle contains exactly one of the two.
 *
 * The mobile entry injects its instance at startup (it must exist before the
 * first render to catch a cold-start tap); everything else asks for it here.
 */
let injected = null;
let loading = null;

export function setPushService(service) {
  injected = service;
}

export function getPushService() {
  if (injected) return Promise.resolve(injected);
  if (!loading) {
    loading = (
      IS_MOBILE_BUILD
        ? import('@platform/capacitor/push').then((m) => m.createCapacitorPush())
        : import('@platform/web/push').then((m) => m.createWebPush())
    ).catch(() => null);
  }
  return loading;
}
