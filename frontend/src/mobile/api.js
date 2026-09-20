/**
 * The mobile client's composition root for the API layer.
 *
 * This file is the point of everything in `core/` and `platform/`. It builds a
 * complete, working API client for a second client — its own transport, its own
 * token cache, its own CSRF token, its own failover flag, its own ETag cache,
 * its own twenty endpoint namespaces — and it does so without importing one
 * line from `shared/api/apiClient.js`.
 *
 * Compare it with that file side by side. The two are the same shape and share
 * no state: the same `core/` modules, assembled over a different `platform/`.
 * That is what "web and mobile can each be redesigned without touching the
 * other" means in practice, and it is now demonstrable rather than asserted.
 *
 * WHAT IS DIFFERENT FROM THE WEB ROOT, AND WHY
 *   • `createCapacitorApiOrigin` instead of `createWebApiOrigin`. This is
 *     blocker B1's fix: the web version derives the API host from
 *     `window.location`, which inside a WebView says `localhost`.
 *   • Storage comes from `platform/capacitor/`, which today re-exports the
 *     browser implementations because a WebView genuinely has them.
 *
 * WHAT IS NOT DIFFERENT YET, AND IS DELIBERATELY LEFT ALONE
 * The session source. The web one drives Supabase's auth client and a
 * password-recovery latch; whether native keeps cookies or moves to bearer
 * tokens is what the on-device spike decides, and the answer changes this line
 * and nothing else. Until it is measured, using the same source is the honest
 * position — it is also what Phase 4 needs, which is the existing app running
 * inside a shell.
 */
import { supabase, isRecoveryTab, clearRecoveryTab } from '@shared/lib/supabase';
import { applyAccountStatusCorrection } from '@shared/lib/accountStatusCorrection';
import {
  announceLegalConsentChange,
  LEGAL_ACK_REQUIRED_CODE,
} from '@shared/lib/legalConsent';
import { config } from '@config';
import { createTransport } from '@core/api/transport';
import { createEndpoints } from '@core/api/endpoints';
import { createEtagCache } from '@core/api/etagCache';
import { createMediaUrls } from '@core/api/media';
import { createCapacitorApiOrigin } from '@platform/capacitor/apiOrigin';
import {
  createNativeCookieReader,
  createNativeLocalStore,
  createNativeSessionStore,
  createNativeTransportHooks,
} from '@platform/capacitor/storage';
import { createWebSessionSource } from '@platform/web/sessionSource';

const apiOrigin = createCapacitorApiOrigin({ config });
const sessionStore = createNativeSessionStore();
const localStore = createNativeLocalStore();
const cookies = createNativeCookieReader();
const etags = createEtagCache({ store: sessionStore });

const session = createWebSessionSource({ supabase, isRecoveryTab, clearRecoveryTab });

const hooks = createNativeTransportHooks({
  onApiErrorCode: (errorCode) => {
    applyAccountStatusCorrection(errorCode);
    if (errorCode === LEGAL_ACK_REQUIRED_CODE) {
      announceLegalConsentChange('required');
    }
  },
});

export const transport = createTransport({
  apiOrigin,
  session,
  cookies,
  localStore,
  sessionStore,
  etags,
  hooks,
});

export const apiClient = transport.apiClient;
export const getBackendUrl = transport.getBackendUrl;
export const getAccessToken = transport.getAccessToken;

export const { getMediaUrl } = createMediaUrls({
  apiOrigin,
  getBackendUrl: (...args) => transport.getBackendUrl(...args),
});

export const endpoints = createEndpoints({
  apiClient: transport.apiClient,
  getToken: transport.getToken,
  getBackendUrl: transport.getBackendUrl,
});
