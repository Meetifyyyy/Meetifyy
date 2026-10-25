const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/ogg': 'ogv',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/webm': 'webm',
  'audio/ogg': 'oga',
  // Safari and iOS record voice notes as AAC in an MP4 container.
  'audio/mp4': 'm4a',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
};

/**
 * The storage-key extension for a content type.
 *
 * The extension of a stored object decides how a CDN/browser will treat it, so
 * it must come from the (validated) content type — never from a client-supplied
 * filename, which let `evil.html` be stored under an `.html` key.
 */
export function extensionForMime(contentType: string): string {
  return EXTENSIONS[baseMimeType(contentType)] || 'bin';
}

/**
 * The type without its parameters, lower-cased: `audio/webm;codecs=opus` is
 * `audio/webm`. A browser's MediaRecorder reports the codec as a parameter, so
 * every check against the allowlist has to compare the essence.
 */
export function baseMimeType(contentType: string): string {
  return String(contentType || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
}

/**
 * Every type an upload may be stored as. Shared by the presign and the
 * pass-through, which used to carry separate copies of this pattern.
 */
const UPLOAD_TYPE =
  /^(image\/(jpeg|png|webp|gif)|video\/(mp4|webm|ogg)|audio\/(mpeg|wav|webm|ogg|mp4))$/;

/** Parameters a declared type may carry: `name=value` tokens, nothing else. */
const TYPE_PARAMS =
  /^(\s*;\s*[a-z0-9-]+=("[a-z0-9.,+ -]*"|[a-z0-9.,+-]+))*\s*$/i;

/** True when `contentType` is an allowed upload type, with or without parameters. */
export function isAllowedUploadType(contentType: string): boolean {
  if (typeof contentType !== 'string') return false;
  const semi = contentType.indexOf(';');
  const params = semi === -1 ? '' : contentType.slice(semi);
  return (
    UPLOAD_TYPE.test(baseMimeType(contentType)) && TYPE_PARAMS.test(params)
  );
}
