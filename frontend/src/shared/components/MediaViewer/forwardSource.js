/**
 * The URL a forwarded message may carry for a viewer item, or null when the item
 * cannot be forwarded.
 *
 * A forward stores whatever it is given as the new message's media. Three kinds
 * of input are therefore refused rather than stored:
 *
 *   - `blob:` / `data:` URLs exist only in this tab (an upload still in flight, a
 *     pasted image); the recipient could never load them;
 *   - signed URLs carry a short-lived signature, so the forwarded message would
 *     stop loading once it lapses, with no key left to sign it again;
 *   - anything that is not a non-empty string.
 *
 * What is forwarded is the URL the opener gave (`rawUrl`, usually the stored
 * `/api/media/<key>` form), not the absolute address the viewer resolved it to:
 * that one names the API host of THIS environment.
 */
const SIGNED_QUERY = /[?&](?:x-amz-[a-z0-9-]+|x-goog-[a-z0-9-]+|signature|sig|expires|token)=/i;

export function forwardableMediaUrl(item) {
  const source = item?.rawUrl ?? item?.url;
  if (typeof source !== 'string' || source === '') return null;
  if (/^(?:blob|data):/i.test(source)) return null;
  if (SIGNED_QUERY.test(source)) return null;
  return source;
}
