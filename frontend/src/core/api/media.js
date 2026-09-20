/**
 * Turning whatever is stored against a record into a URL a client can render.
 *
 * Media references arrive in several shapes — a bare object key, an absolute
 * URL written by whichever machine uploaded it, a DiceBear avatar, a data: or
 * blob: URL — and every client has to resolve all of them the same way or the
 * same profile renders differently on web and on a phone.
 *
 * Three of these are pure and exported directly. `getMediaUrl` is not: it has
 * to know where the API is and whether this client can reach a private origin,
 * so it is built by a factory over the same injected pieces the transport uses.
 */

const PASTEL_BG_COLORS = ['b6e3f4', 'c084fc', 'fde047', '86efac', 'fca5a5', 'fdba74', 'a5f3fc', 'f472b6'];

export const getPastelBgColor = (seed = '') => {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return PASTEL_BG_COLORS[Math.abs(hash) % PASTEL_BG_COLORS.length];
};

export const normalizeDicebearUrl = (url) => {
  if (!url || typeof url !== 'string') return url;
  if (!url.includes('api.dicebear.com/')) return url;

  // Preserve existing backgroundColor parameter if already defined on the avatar URL
  if (url.includes('backgroundColor=')) {
    return url;
  }

  const bg = 'b6e3f4';
  const joinChar = url.includes('?') ? '&' : '?';
  return `${url}${joinChar}backgroundColor=${bg}`;
};

/**
 * Derives the object key of an image's lightweight thumbnail variant from the
 * original's key/URL, using the convention `<folder>/<name>.<ext>` ->
 * `<folder>/<name>_thumb.webp`. Returns null for anything that isn't one of our
 * own uploaded R2/media images (external URLs, data/blob URLs, already-a-thumb),
 * so callers can fall back to the original safely.
 */
export const deriveThumbnailKey = (rawSrc) => {
  if (!rawSrc || typeof rawSrc !== 'string') return null;
  let key = rawSrc.trim();
  if (key.startsWith('data:') || key.startsWith('blob:')) return null;

  // Full external URLs that aren't our media endpoint are not derivable.
  if ((key.startsWith('http://') || key.startsWith('https://'))) {
    const m = key.match(/\/api\/media\/(.+)$/);
    if (!m) return null;
    key = m[1];
  } else if (key.includes('/api/media/')) {
    const m = key.match(/\/api\/media\/(.+)$/);
    if (m) key = m[1];
  }
  key = key.split('?')[0].replace(/^\/+/, '');

  // Only derive for our folder/uuid.ext keys; skip if it's already a thumbnail.
  if (/_thumb\.[a-z0-9]+$/i.test(key)) return null;
  const match = key.match(/^([a-z0-9_-]+)\/([A-Za-z0-9._-]+)\.(webp|jpe?g|png|gif|mp4|webm|ogv|mov)$/i);
  if (!match) return null;
  const [, folder, name] = match;
  return `${folder}/${name}_thumb.webp`;
};

/**
 * Whether a hostname belongs to a network that is private to whoever is on it.
 *
 * Used here to classify the host inside a STORED url — a question about the
 * data, not about this client — which is why it stays in core. The mirror
 * question, "is the client itself on such a network", is a platform one and is
 * answered by `ApiOrigin.privateMediaTarget()`.
 */
export const isPrivateNetworkHost = (host) =>
  host === 'localhost' ||
  host === '127.0.0.1' ||
  /^(192\.168\.|10\.|100\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|.+\.local$)/.test(host) ||
  /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);

/**
 * @param {object} deps
 * @param {{ privateMediaTarget: () => ({kind:'local',base:string}|{kind:'api'}|null) }} deps.apiOrigin
 * @param {() => string} deps.getBackendUrl  failover-aware; owned by the transport
 */
export function createMediaUrls({ apiOrigin, getBackendUrl }) {
  const getMediaUrl = (pathOrUrl) => {
    if (!pathOrUrl || typeof pathOrUrl !== 'string') return '';

    let finalUrl = pathOrUrl;

    if (finalUrl.includes('api.dicebear.com/')) {
      finalUrl = normalizeDicebearUrl(finalUrl);
    }

    /**
     * A stored URL naming a private origin is never handed back untouched.
     * There are only two honest outcomes — rewrite it to an origin this client
     * can actually reach, or drop it — and which one applies is the platform's
     * answer, not this module's.
     */
    if (/^https?:\/\//i.test(finalUrl)) {
      let parsed = null;
      try { parsed = new URL(finalUrl); } catch { parsed = null; }

      if (parsed && isPrivateNetworkHost(parsed.hostname)) {
        const target = apiOrigin.privateMediaTarget();
        // `null` means the client cannot tell where it is, so it leaves the URL
        // alone — the same thing the old code did when there was no `window`.
        if (target) {
          const pathAndQuery = `${parsed.pathname}${parsed.search}`;
          if (target.kind === 'local') {
            finalUrl = `${target.base}${pathAndQuery}`;
          } else {
            const backend = getBackendUrl();
            if (!backend) return '';
            finalUrl = `${backend}${pathAndQuery}`;
          }
        }
      }
    }

    if (finalUrl.startsWith('http://') || finalUrl.startsWith('https://') || finalUrl.startsWith('data:') || finalUrl.startsWith('blob:')) {
      return finalUrl;
    }
    // Anything reaching here is treated as a media key and turned into
    // /api/media/<key>. Guard against values that cannot be one: a stray initial
    // or label produced requests like GET /api/media/H, which the backend
    // answered with 400 on every render. A real key always carries a path
    // separator or a file extension.
    const candidate = finalUrl.replace(/^\/+/, '');
    const looksLikeMediaKey = candidate.includes('/') || /\.[a-z0-9]{2,5}$/i.test(candidate);
    if (!looksLikeMediaKey) return '';

    const cleanPath = finalUrl.startsWith('/api/media/')
      ? finalUrl
      : `/api/media/${candidate}`;
    const backendUrl = getBackendUrl();
    return `${backendUrl.replace(/\/+$/, '')}${cleanPath}`;
  };

  return { getMediaUrl };
}
