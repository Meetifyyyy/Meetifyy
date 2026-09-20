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
 * Key/value storage that answers without awaiting.
 *
 * WHY THIS EXISTS ALONGSIDE THE ASYNC ONE
 * `KeyValueStore` is async because the native stores are, and that is right for
 * anything that can wait. It is wrong for the request hot path: the ETag for a
 * URL is read while a GET is being assembled, so an async store would put a
 * bridge round-trip in front of every single request on a device — latency
 * added to every screen, to save a few kilobytes of memory.
 *
 * So the hot path takes this instead. The web implementation is
 * `sessionStorage`, which is synchronous anyway. A native implementation is an
 * in-memory Map, hydrated once at startup from the async store and written
 * through in the background — the read stays instant and the data still
 * survives a restart.
 *
 * Never used for credentials: see SecureStorage.
 */
export interface SyncKeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  /** Every key this store owns, for the logout purge. */
  clear(): void;
}

/**
 * What the transport tells the app when something happens to a request.
 *
 * These replace `window.dispatchEvent` calls that the transport used to make
 * directly. A DOM event is a perfectly good way for the web app to hear about
 * this; it is simply not available to a native client, and the transport should
 * not be the thing that decides which mechanism is used.
 *
 * Every hook is optional, and a client that supplies none still gets a working
 * transport — these are notifications, not control flow.
 */
export interface TransportHooks {
  /**
   * A machine-readable error code came back from the API.
   *
   * The web app uses this to reconcile an account status the server knows about
   * and the tab does not, and to raise the legal-acknowledgement gate. The
   * transport deliberately does not know which codes mean what: it reports, the
   * app decides.
   */
  onApiErrorCode?(code: string): void;
  /** The session is over and the app should stop acting signed in. */
  onUnauthorized?(): void;
  /** The API moved to the fallback origin; anything holding a socket must follow. */
  onOriginChanged?(): void;
}

/**
 * Where the current access token comes from, and whether it may be used.
 *
 * The web app's answer involves Supabase's auth client and a per-tab
 * password-recovery latch; a native client's will not. What the transport needs
 * is narrower than either: a token, and permission to send it.
 */
export interface SessionSource {
  /** The bearer token, or '' when this client is holding none. */
  getToken(): string;
  /**
   * True when the credential in hand is a password-recovery session rather than
   * a login.
   *
   * It must never be sent to the API. A recovery token is an ordinary session
   * JWT — the backend cannot tell it from a login, which is exactly why the
   * client has to.
   */
  isRecoveryCredential(): boolean;
  /** Resolves once an initial session has been loaded, if the client loads one. */
  whenReady(): Promise<unknown> | null;
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
