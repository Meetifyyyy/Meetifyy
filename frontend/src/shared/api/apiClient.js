/**
 * The web client's composition root for the API layer.
 *
 * This file assembles, and does almost nothing else. The transport lives in
 * `core/api/transport.js`, the endpoint definitions in `core/api/endpoints.js`,
 * the media and route rules beside them; the browser's answers to "where is the
 * API", "where do I put a string", "where does the token come from" and "what
 * does this error code mean" live in `platform/web/`. Here the two halves meet,
 * and this is the only file allowed to know both.
 *
 * A mobile client will have its own version of this file — the same core
 * modules, `platform/capacitor/` in place of `platform/web/` — and none of the
 * core modules will notice the difference. That is the whole point of the
 * arrangement, and the reason this file is short.
 *
 * Everything below is re-exported under the name it has always had, so the 107
 * modules that import from here are unaffected by any of it.
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
import {
  createMediaUrls,
  deriveThumbnailKey as _deriveThumbnailKey,
  getPastelBgColor as _getPastelBgColor,
  normalizeDicebearUrl as _normalizeDicebearUrl,
} from '@core/api/media';
import { createWebApiOrigin } from '@platform/web/apiOrigin';
import { createWebSessionSource } from '@platform/web/sessionSource';
import {
  createWebCookieReader,
  createWebLocalStore,
  createWebSessionStore,
  createWebTransportHooks,
} from '@platform/web/storage';

// ── The browser's answers ────────────────────────────────────────────────────

const apiOrigin = createWebApiOrigin({ config });
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
const session = createWebSessionSource({ supabase, isRecoveryTab, clearRecoveryTab });

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
