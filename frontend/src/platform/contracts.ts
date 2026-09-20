/**
 * Platform capability contracts.
 *
 * The interfaces here are the whole of what `core/` and a client's UI are
 * allowed to know about the device they are running on. Each has a web
 * implementation under `platform/web/`, and later a Capacitor one under
 * `platform/capacitor/` — the only directory in this repository permitted to
 * import `@capacitor/*`. Replacing Capacitor with React Native replaces the
 * implementations and leaves this file alone; that is the point of it.
 *
 * Wiring is by dependency injection at each client's composition root, never by
 * an `isNative()` check scattered through feature code. A component that asks
 * "am I native?" has to be edited when a third platform appears; a component
 * handed a `PlatformServices` does not.
 *
 * WHY THIS FILE IS TYPESCRIPT WHEN THE REST OF THE FRONTEND IS NOT
 * It is a contract between implementations that do not import each other and
 * cannot be checked against each other at runtime. A JS "interface" here would
 * be a comment. The cost is bounded: this file and `core/navigation/intents.ts`
 * are the only two, and Vite compiles `.ts` with no extra configuration.
 *
 * SCOPE RULE — an interface is added here when its FIRST CONSUMER IS BEING
 * WRITTEN, not before. Every entry below names that consumer. An interface with
 * no named consumer is a guess about the future, and the ones already refused
 * are recorded in the architecture plan rather than half-declared here.
 * Deliberately absent, and deferred until a mobile screen needs them:
 * MediaCapture, Share, Clipboard, Haptics, Geolocation.
 */

/**
 * Non-secret key/value storage.
 *
 * Consumer: `core/api/transport` — the ETag store and the API-failover flag,
 * which today read `localStorage` and `sessionStorage` directly.
 *
 * Async because the native implementations are. The web implementation is
 * synchronous underneath and simply resolves; making the CONTRACT async is what
 * stops a caller being written against synchronous behaviour that only web has.
 *
 * Every method may reject: storage is blocked in private browsing, and a native
 * store can be unavailable during early startup. Callers must treat a failure
 * as "no value", never as fatal.
 */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  /** Everything this store owns. Used by the logout purge. */
  clear(): Promise<void>;
}

/**
 * Storage for credentials, and for nothing else.
 *
 * Consumer: the native refresh-token store (Phase 5).
 *
 * Separate from `KeyValueStore` because the implementations are not
 * interchangeable and must never be confused: this is Keychain / Keystore, that
 * is `localStorage` / Preferences. Two names make the wrong choice visible in
 * review.
 *
 * THE WEB IMPLEMENTATION THROWS. On web the session lives in HttpOnly cookies
 * that scripts cannot read by design, so nothing on web has any business
 * calling this — and the available Capacitor secure-storage plugins all fall
 * back to plain or base64 `localStorage` on the web platform, which would
 * quietly turn "secure storage" into "a string on disk". Failing loudly is the
 * only honest web behaviour.
 */
export interface SecureStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Where the API lives, and how to reach it.
 *
 * Consumer: `core/api/transport` — it replaces `directBackendUrl()`, which
 * derives the API origin from `window.location.hostname`.
 *
 * This interface exists because that derivation is actively wrong inside a
 * WebView: the page origin is `https://localhost` (Android) or
 * `capacitor://localhost` (iOS), `isLocalNetworkHost('localhost')` is true, and
 * the client resolves the API to `https://localhost:4000`. The native
 * implementation returns the configured origin and probes nothing.
 */
export interface ApiOrigin {
  /** Absolute origin, no trailing slash. */
  baseUrl(): string;
  /** Absolute WebSocket origin. */
  socketUrl(): string;
  /**
   * A same-origin fallback, when the platform has one. Web returns a proxy
   * prefix for filtered networks; native returns null — there is no origin to
   * fall back to inside a bundled app.
   */
  fallbackBaseUrl(): string | null;

  /**
   * What to do with a media URL that names a PRIVATE origin.
   *
   * Stored media carries the API origin of whichever machine wrote it, so
   * anything uploaded during local development names a LAN address, a Tailscale
   * address or a `.local` name. Serving one to a public page is not merely a
   * dead image — the browser treats it as the site reaching into the viewer's
   * own network, and Chrome 138+ prompts about exactly that.
   *
   * Three honest answers, and the caller cannot work out which without knowing
   * the platform:
   *   `{ kind: 'local', base }` — this client is itself on that network, so
   *       rewrite to `base` and the image resolves.
   *   `{ kind: 'api' }` — this client is not, so the private origin is
   *       unreachable and the configured API is the only other option.
   *   `null` — this client cannot tell (no location at all), so leave the URL
   *       alone rather than guess.
   *
   * A native client returns `{ kind: 'api' }` unconditionally. This is the
   * second place the old `window.location.hostname` derivation went wrong
   * inside a WebView: the page origin is `localhost`, which reads as "on the
   * local network", so every private media URL would have been rewritten to
   * `capacitor://localhost:4000/...` and every such image would break.
   */
  privateMediaTarget(): { kind: 'local'; base: string } | { kind: 'api' } | null;
}

/** Online/offline, replacing `navigator.onLine`, which is unreliable in a WebView. */
export interface NetworkStatus {
  isOnline(): Promise<boolean>;
  /** Returns an unsubscribe function. */
  onChange(listener: (online: boolean) => void): () => void;
}

/**
 * Foreground/background transitions.
 *
 * Consumer: each client's composition root — socket reconnect, refetch of
 * active queries, badge clearing.
 *
 * Mobile needs this because React Query's `refetchOnWindowFocus` does not fire
 * in a WebView the way it does in a browser tab, so "the user came back" has to
 * arrive from somewhere else.
 */
export interface AppLifecycle {
  onResume(listener: () => void): () => void;
  onPause(listener: () => void): () => void;
}

/**
 * Inbound links, from the OS or from a notification tap.
 *
 * Consumer: `src/mobile/navigation/intentToRoute` (Phase 5).
 *
 * Deliberately emits an `Intent` rather than a URL or a route: a route is the
 * one thing that will be rewritten if this app ever moves to React Navigation.
 * See `core/navigation/intents.ts`.
 */
export interface DeepLinks {
  onOpen(listener: (intent: import('../core/navigation/intents').Intent) => void): () => void;
  /**
   * An intent that arrived before a listener was attached — a cold start from a
   * link or a notification. Drained once, after auth resolves.
   */
  takePending(): import('../core/navigation/intents').Intent | null;
}

/**
 * What this build is running on.
 *
 * Consumer: session registration (Phase 6) — it supplies `UserSession.platform`
 * and `UserSession.appVersion`, whose stated purposes are the devices list
 * ("iPhone · Meetifyy 2.1.0" rather than a parsed WebView user-agent), the
 * force-upgrade gate, and crash triage.
 */
export interface DeviceInfo {
  platform(): 'web' | 'ios' | 'android';
  appVersion(): string;
  /** Stable per-installation. Null on web, which has no such concept. */
  installationId(): Promise<string | null>;
}

/**
 * Push registration and delivery.
 *
 * Consumer: push registration and tap routing (Phase 6).
 *
 * `onNotificationTap` yields an `Intent`, not a payload: the payload carries
 * routing data only — no message content, no email address, no user id, no
 * token — because it transits Google and Apple infrastructure and lands in OS
 * logs.
 */
export interface PushService {
  requestPermission(): Promise<'granted' | 'denied' | 'unsupported'>;
  getToken(): Promise<string | null>;
  /** Tokens rotate silently; re-register whenever this fires. */
  onToken(listener: (token: string) => void): () => void;
  onNotificationTap(
    listener: (intent: import('../core/navigation/intents').Intent) => void,
  ): () => void;
  /** Called on logout, alongside server-side revocation of the same token. */
  deleteToken(): Promise<void>;
}

/**
 * The bundle a composition root assembles and injects.
 *
 * Optional members are capabilities a given platform genuinely does not have.
 * A consumer must handle absence rather than assume — that is what keeps a
 * feature from silently requiring a platform.
 */
export interface PlatformServices {
  keyValue: KeyValueStore;
  apiOrigin: ApiOrigin;
  network: NetworkStatus;
  lifecycle: AppLifecycle;
  device: DeviceInfo;
  secureStorage?: SecureStorage;
  deepLinks?: DeepLinks;
  push?: PushService;
}
