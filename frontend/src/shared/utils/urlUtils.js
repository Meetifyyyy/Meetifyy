/**
 * Extracts the first URL found in a string of text.
 * Returns null if no URL is present.
 */
export function extractURL(text) {
  if (!text) return null;
  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`[\]]+/i;
  const match = text.match(urlRegex);
  return match ? match[0] : null;
}

/**
 * Returns true if the string contains at least one URL.
 */
export function containsURL(text) {
  return extractURL(text) !== null;
}

/**
 * Returns true if the message content is purely a URL with no surrounding text
 */
export function isOnlyURL(text) {
  if (!text) return false;
  return /^(https?:\/\/[^\s]+|www\.[^\s]+)$/.test(text.trim());
}
