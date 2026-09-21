/**
 * The composition root for the API layer — for the website AND for the app.
 *
 * One file, both targets, because the app IS the website: the native build
 * bundles the same React tree and runs it in a WebView. What differs between
 * them is not the code, it is a handful of answers about the device it is
 * running on, and this is where those are chosen.
 *
 * Today that is one answer — where the API lives — chosen from
 * `IS_MOBILE_BUILD`, which Vite replaces with a literal so the unused
 * implementation never reaches the bundle. If the on-device spike shows more
 * has to differ (secure token storage, say), those choices are added here and
 * the 107 modules importing from this file still do not change.
 *
 * Everything below is re-exported under the name it has always had.
 */
import { supabase, isRecoveryTab, clearRecoveryTab } from '@shared/lib/supabase';
import { applyAccountStatusCorrection } from '@shared/lib/accountStatusCorrection';
import {
  announceLegalConsentChange,
  LEGAL_ACK_REQUIRED_CODE,
} from '@shared/lib/legalConsent';
import { config, IS_MOBILE_BUILD } from '@config';
import { createTransport } from '@core/api/transport';
import { createEndpoints } from '@core/api/endpoints';
import { createEtagCache } from '@core/api/etagCache';
import {
  createMediaUrls,
  deriveThumbnailKey as _deriveThumbnailKey,
  getPastelBgColor as _getPastelBgColor,
  normalizeDicebearUrl as _normalizeDicebearUrl,
} from '@core/api/media';
import { createWebApiOrigin } from '@platform/web/apiOrigin';
import { createCapacitorApiOrigin } from '@platform/capacitor/apiOrigin';
import { createWebSessionSource } from '@platform/web/sessionSource';
import { createCapacitorSessionSource } from '@platform/capacitor/sessionSource';
import { createCapacitorSecureStorage } from '@platform/capacitor/secureStorage';
import {
  createWebCookieReader,
  createWebLocalStore,
  createWebSessionStore,
  createWebTransportHooks,
} from '@platform/web/storage';

// ── The browser's answers ────────────────────────────────────────────────────

/**
 * Where the API is — and this single line is what lets the SAME app run on the
 * web and inside a native shell.
 *
 * The web implementation works out the backend host from `window.location`, so
 * that a page served from a laptop or a phone on the same Wi-Fi talks to a
 * backend on that host. Inside a Capacitor WebView that reasoning is wrong:
 * the page origin is `https://localhost` on Android and `capacitor://localhost`
 * on iOS, so it would resolve the API to `https://localhost:4000` and every
 * request would fail in a way that reads as "the backend is down".
 *
 * `IS_MOBILE_BUILD` and not `config.client`: Vite replaces the former with a
 * literal, so Rollup folds this branch and the other implementation never
 * reaches the bundle. Reading it off `config` is an ordinary property access
 * and eliminates nothing — the first version of this line did exactly that, and
 * shipped the native origin to the website.
 */
const apiOrigin = IS_MOBILE_BUILD
  ? createCapacitorApiOrigin({ config })
  : createWebApiOrigin({ config });
const sessionStore = createWebSessionStore();
const localStore = createWebLocalStore();
const cookies = createWebCookieReader();
const etags = createEtagCache({ store: sessionStore });

/**
 * Where the access token comes from, and whether it may be sent.
 *
 * The Supabase subscription and the password-recovery guard that used to run at
 * this file's module scope live behind this now. See
 * platform/web/sessionSource.js for why the recovery guard belongs in one place
 * rather than at the three call sites that each had to remember it.
 */
const session = IS_MOBILE_BUILD
  ? createCapacitorSessionSource({ secureStorage: createCapacitorSecureStorage() })
  : createWebSessionSource({ supabase, isRecoveryTab, clearRecoveryTab });

/**
 * What the transport reports, and what this app does about it.
 *
 * The transport knows a response carried a machine-readable code; it
 * deliberately does not know which codes mean what. Both reactions here are app
 * policy — reconciling an account status this tab has not heard about, and
 * raising the mandatory-acknowledgement gate.
 */
const hooks = createWebTransportHooks({
  onApiErrorCode: (errorCode) => {
    applyAccountStatusCorrection(errorCode);
    if (errorCode === LEGAL_ACK_REQUIRED_CODE) {
      announceLegalConsentChange('required');
    }
  },
});

// ── The transport ────────────────────────────────────────────────────────────

const transport = createTransport({
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
export const isApiFailoverActive = transport.isApiFailoverActive;
export const readCsrfCookie = transport.readCsrfCookie;
export const whenSessionReady = transport.whenSessionReady;
export const rememberCsrfToken = transport.rememberCsrfToken;
export const forgetCsrfToken = transport.forgetCsrfToken;
export const mayHaveCookieSession = transport.mayHaveCookieSession;

/**
 * The same-origin proxy prefix, read here because configuration is this file's
 * business rather than the transport's.
 *
 * The socket store imports it to move realtime onto the proxy when the API has
 * failed over — an HTTP rewrite will not complete a WebSocket upgrade, so that
 * connection stays on long polling. Degraded, but live.
 */
export const API_PROXY_PREFIX = config.api.proxyPrefix;

// ── Media URLs ───────────────────────────────────────────────────────────────

/**
 * Three of these are pure and pass straight through. `getMediaUrl` is built
 * over the same platform seam as the API origin, because "can this client reach
 * a private address" is the same question in both places — and it was answered
 * wrongly in both inside a WebView, where every LAN-origin image would have
 * been rewritten to `capacitor://localhost:4000`.
 */
export const getPastelBgColor = _getPastelBgColor;
export const normalizeDicebearUrl = _normalizeDicebearUrl;
export const deriveThumbnailKey = _deriveThumbnailKey;

export const { getMediaUrl } = createMediaUrls({
  apiOrigin,
  getBackendUrl: (...args) => transport.getBackendUrl(...args),
});

// ── Named API helpers ────────────────────────────────────────────────────────

const endpoints = createEndpoints({
  apiClient: transport.apiClient,
  getToken: transport.getToken,
  getBackendUrl: transport.getBackendUrl,
});

/**
 * Hands the native client the tokens from a login or a signup handover.
 *
 * A no-op on web, and deliberately shaped like `rememberCsrfToken` beside it:
 * the caller passes the whole response body and does not need to know which
 * fields matter, or which platform it is on. The web response simply carries
 * none of them — the server returns tokens only to the native origin.
 */
export const rememberSessionTokens = (body) => session.adopt?.(body);

/** The other half: signing out must destroy the stored credential. */
export const forgetSessionTokens = () => session.forget?.();

export const authApi = endpoints.authApi;
export const postsApi = endpoints.postsApi;
export const shareApi = endpoints.shareApi;
export const linkPreviewApi = endpoints.linkPreviewApi;
export const communitiesApi = endpoints.communitiesApi;
export const activitiesApi = endpoints.activitiesApi;
export const sessionsApi = endpoints.sessionsApi;
export const usersApi = endpoints.usersApi;
export const dmApi = endpoints.dmApi;
export const groupApi = endpoints.groupApi;
export const instantMatchApi = endpoints.instantMatchApi;
export const messagesApi = endpoints.messagesApi;
export const healthApi = endpoints.healthApi;
export const uploadsApi = endpoints.uploadsApi;
export const campusEventsApi = endpoints.campusEventsApi;
export const notificationsApi = endpoints.notificationsApi;
export const searchApi = endpoints.searchApi;
export const reportsApi = endpoints.reportsApi;
export const legalApi = endpoints.legalApi;
export const supportApi = endpoints.supportApi;
