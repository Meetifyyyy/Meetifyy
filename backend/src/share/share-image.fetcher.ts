import { Logger } from '@nestjs/common';

/**
 * Pulls one image into memory for the OG card, or gives up quietly.
 *
 * WHY THE LIMITS ARE HARD RATHER THAN ADVISORY
 * This runs inside a request an unfurler is waiting on, in the same process
 * that serves the API. An unbounded download here is an unbounded memory
 * allocation and an unbounded stall on a public, unauthenticated endpoint —
 * which is to say it is the denial-of-service, not a performance concern. So
 * every axis is capped: wall clock, declared size, actual streamed size, and
 * content type.
 *
 * WHY EVERY FAILURE IS A NULL
 * A card that renders without its photo is a good card. A share endpoint that
 * 500s because a CDN was slow is a broken link on WhatsApp. There is no failure
 * mode here worth propagating, so there are no exceptions — the caller falls
 * back to the text layout, which needs nothing external.
 */
const logger = new Logger('ShareImageFetcher');

/** Wall clock for the whole fetch. Unfurlers themselves time out around 5-10s. */
const TIMEOUT_MS = 4_000;

/**
 * Ceiling on bytes read. Post images are already optimised by the upload
 * pipeline and sit well under this; anything above it is not something to
 * decode inside a web request.
 */
const MAX_BYTES = 6 * 1024 * 1024;

const ALLOWED_CONTENT_TYPE = /^image\/(png|jpeg|jpg|webp|gif|avif)\b/i;

/**
 * Fetches `url`, returning the bytes or null.
 *
 * `allowedOrigins` is defence in depth, not the primary control: these URLs are
 * built by StorageService from a configured public host and a database column,
 * never from anything a request carries. Pinning the origin anyway means that a
 * `Media.objectKey` which somehow held an absolute URL — a legacy row, a future
 * import — cannot turn this into a request generator pointed wherever that row
 * says. An empty list disables the check, which is what local development needs
 * and what production must never have.
 */
export async function fetchImageBytes(
  url: string,
  allowedOrigins: string[] = [],
): Promise<Buffer | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (allowedOrigins.length && !allowedOrigins.includes(parsed.origin)) {
    logger.warn(
      `share.image_origin_refused ${parsed.origin} is not a configured media origin`,
    );
    return null;
  }

  try {
    const response = await fetch(parsed, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: 'image/*' },
    });

    if (!response.ok || !response.body) return null;

    const contentType = response.headers.get('content-type') ?? '';
    if (!ALLOWED_CONTENT_TYPE.test(contentType)) return null;

    const declared = Number(response.headers.get('content-length') ?? '0');
    if (declared > MAX_BYTES) return null;

    // Streamed with a running total rather than `await response.arrayBuffer()`:
    // Content-Length is a claim, and a response that lies about it (or omits it)
    // would otherwise be buffered in full before anyone checked the size.
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      total += chunk.byteLength;
      if (total > MAX_BYTES) {
        logger.warn(`share.image_too_large ${parsed.pathname}`);
        return null;
      }
      chunks.push(Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
  } catch (error) {
    // Debug, not warn: a missing thumbnail variant is an expected miss on the
    // fallback path below, and logging it at warn level would make a healthy
    // system look unhealthy.
    logger.debug(
      `share.image_fetch_failed ${parsed.pathname}: ${(error as Error)?.message}`,
    );
    return null;
  }
}

/**
 * Tries each URL in turn and returns the first that loads.
 *
 * The caller offers an optimised variant first and the original second. The
 * upload pipeline only produces `_thumb.webp` for some folders, so asking for
 * one that does not exist is normal rather than exceptional — this is the
 * cheapest way to prefer the small file without maintaining a second copy of
 * the rules about which folders have thumbnails.
 */
export async function fetchFirstAvailableImage(
  urls: (string | null | undefined)[],
  allowedOrigins: string[] = [],
): Promise<Buffer | null> {
  for (const url of urls) {
    if (!url) continue;
    const bytes = await fetchImageBytes(url, allowedOrigins);
    if (bytes) return bytes;
  }
  return null;
}
