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
  return EXTENSIONS[contentType.toLowerCase()] || 'bin';
}
