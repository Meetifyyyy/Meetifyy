import { getConversationSlug } from './slugify';

/**
 * Generates a canonical public URL for a conversation.
 * Format: /inbox/:slug/:publicId or /messages/:slug/:publicId
 *
 * @param {Object} conversation - Conversation object
 * @param {string} currentUserId - Logged-in user's ID
 * @param {string} basePath - Base route prefix ('/inbox' or '/messages')
 * @returns {string} Canonical conversation URL
 */
export function generateConversationUrl(conversation, currentUserId, basePath = '/inbox') {
  if (!conversation) return basePath;

  const publicId = conversation.publicId || conversation.id;
  const slug = getConversationSlug(conversation, currentUserId) || 'chat';

  return `${basePath}/${slug}/${publicId}`;
}

/**
 * Parses conversation route parameters safely.
 * Handles both canonical format (/inbox/:slug/:publicId) and legacy format (/inbox/:conversationId/:slug).
 *
 * @param {string} param1 - First route parameter from URL
 * @param {string} param2 - Second route parameter from URL
 * @returns {{ publicId: string|null, slug: string|null, isLegacyFormat: boolean }}
 */
export function parseConversationRoute(param1, param2) {
  if (!param1 && !param2) {
    return { publicId: null, slug: null, isLegacyFormat: false };
  }

  // If only 1 param is present, e.g. /inbox/c8Kx2PwM or /messages/2345fe04-...
  if (!param2) {
    return { publicId: param1, slug: null, isLegacyFormat: true };
  }

  // UUID pattern or legacy prefix (c_...) check for param1
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(param1) ||
                 param1.startsWith('c_');

  if (isUuid) {
    // Legacy format: /inbox/:conversationId/:slug
    return { publicId: param1, slug: param2, isLegacyFormat: true };
  }

  // Canonical format: /inbox/:slug/:publicId
  return { publicId: param2, slug: param1, isLegacyFormat: false };
}

/**
 * Validates whether an actual slug matches the expected slug.
 */
export function validateSlug(actualSlug, expectedSlug) {
  if (!actualSlug || !expectedSlug) return false;
  return actualSlug.toLowerCase() === expectedSlug.toLowerCase();
}

/**
 * Computes the correct canonical URL for a conversation given the current URL path.
 */
export function correctConversationUrl(conversation, currentUserId, currentPathname = '/inbox') {
  if (!conversation) return currentPathname;
  const isInbox = currentPathname.startsWith('/inbox');
  const basePath = isInbox ? '/inbox' : '/messages';
  return generateConversationUrl(conversation, currentUserId, basePath);
}
