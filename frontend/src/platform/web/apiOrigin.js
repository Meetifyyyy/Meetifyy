/**
 * Where the API is, from the browser's point of view.
 *
 * This is the web half of `ApiOrigin` in ../contracts.ts, and it is where every
 * `window.location` question the transport used to ask now lives. The logic is
 * unchanged from the transport it was lifted out of; what changed is that it is
 * now one implementation of an interface rather than the only way this can
 * work.
 *
 * WHY THAT MATTERS MORE THAN IT LOOKS
 * The old code decided where the backend was by inspecting
 * `window.location.hostname`, and inside a Capacitor WebView that hostname is
 * `localhost` — on iOS the whole origin is `capacitor://localhost`. Both of the
 * predicates below would therefore answer "this page is on a local network",
 * and a native build would resolve its API to `https://localhost:4000` (or
 * `capacitor://localhost:4000`) and every media URL to the same. Neither exists.
 *
 * The native implementation is a sibling file that returns the configured
 * origin and probes nothing. That file does not exist yet; this one exists so
 * that when it does, nothing else has to change.
 */

const isLoopbackHost = (host) => host === 'localhost' || host === '127.0.0.1';

/**
 * Loopback, RFC1918, Tailscale (100.x) and mDNS `.local` names — the addresses
 * that are only meaningful to someone already on that network.
 */
const isPrivateNetworkHost = (host) =>
  isLoopbackHost(host) ||
  /^(192\.168\.|10\.|100\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|.+\.local$)/.test(host) ||
  /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);

/**
 * @param {object} deps
 * @param {object} deps.config  the app's validated config object (`@config`)
 */
export function createWebApiOrigin({ config }) {
  const hasLocation = () =>
    typeof window !== 'undefined' && !!window.location?.hostname;

  /**
   * The configured origin, or the developer's own machine.
   *
   * A page served from localhost, Tailscale or a LAN IP talks to a backend on
   * that same host — that is what makes testing from a phone on the same Wi-Fi
   * work. Both the behaviour and the port are configuration
   * (VITE_API_PREFER_LOCAL, VITE_API_LOCAL_PORT); everywhere else the
   * configured VITE_API_URL is used verbatim.
   */
  const baseUrl = () => {
    const { baseUrl: configured, localPort, preferLocalBackend } = config.api;

    if (preferLocalBackend && hasLocation()) {
      const { hostname, protocol } = window.location;
      if (isPrivateNetworkHost(hostname)) {
        return `${protocol}//${hostname}:${localPort}`;
      }
    }

    if (!configured) {
      // No API origin configured: same-origin (the dev server proxy, or a
      // deployment that serves the API under its own domain).
      return '';
    }

    // A secure page cannot call an insecure origin; upgrade rather than fail.
    if (
      hasLocation() &&
      window.location.protocol === 'https:' &&
      configured.startsWith('http://') &&
      !isLoopbackHost(new URL(configured).hostname)
    ) {
      return configured.replace(/^http:\/\//i, 'https://');
    }

    return configured;
  };

  /**
   * The same-origin proxy, which is reachable wherever the app itself is.
   *
   * Campus and other filtered networks routinely blocklist a shared PaaS
   * wildcard domain without blocking the app's own domain, which leaves the
   * shell loading and every request failing at the TCP level. Null when there
   * is no browser origin to build one from.
   */
  const fallbackBaseUrl = () => {
    if (typeof window === 'undefined' || !window.location) return null;
    return `${window.location.origin}${config.api.proxyPrefix}`;
  };

  /** Realtime follows the API; the transport rewrites this on failover. */
  const socketUrl = () => baseUrl();

  const privateMediaTarget = () => {
    if (!hasLocation()) return null;
    const { hostname, protocol } = window.location;
    if (isPrivateNetworkHost(hostname)) {
      return { kind: 'local', base: `${protocol}//${hostname}:${config.api.localPort}` };
    }
    return { kind: 'api' };
  };

  /**
   * Whether the same-origin proxy is a meaningful alternative at all: a real
   * deployment, with the API on a different host. On localhost the API is
   * either already reachable or genuinely down, and there is no proxy behind
   * which to find it.
   */
  const canFailOver = () => {
    if (typeof window === 'undefined' || !window.location) return false;
    if (isLoopbackHost(window.location.hostname)) return false;
    const direct = baseUrl();
    if (!direct) return false;
    try {
      return new URL(direct).host !== window.location.host;
    } catch {
      return false;
    }
  };

  return { baseUrl, socketUrl, fallbackBaseUrl, privateMediaTarget, canFailOver };
}
