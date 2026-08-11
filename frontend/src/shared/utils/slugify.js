/**
 * Reusable utility to convert any text into a clean, human-readable URL slug.
 *
 * Rules:
 * • lowercase
 * • remove special characters
 * • replace spaces and underscores with '-'
 * • collapse duplicate hyphens
 * • trim leading & trailing hyphens
 * • gracefully handle Unicode characters
 */
export function slugify(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics / accents
    .replace(/[^a-z0-9\s-]/g, '') // remove special characters
    .replace(/[\s_]+/g, '-') // replace spaces & underscores with hyphens
    .replace(/-+/g, '-') // collapse consecutive hyphens
    .replace(/^-+|-+$/g, ''); // trim leading & trailing hyphens
}

/**
 * Generates an optional cosmetic slug for a conversation object.
 *
 * For Direct Messages:
 * Uses the other participant's display name or username.
 *
 * For Group Chats:
 * Uses the group name or title.
 */
export function getConversationSlug(conversation, currentUserId) {
  if (!conversation) return '';

  const isGroup = Boolean(
    conversation.isGroup ||
    conversation.type === 'GROUP' ||
    conversation.type === 'COMMUNITY'
  );

  if (!isGroup && Array.isArray(conversation.participants) && conversation.participants.length > 0) {
    const otherPart = conversation.participants.find(
      (p) => String(p.userId || p.id || p.user?.id) !== String(currentUserId)
    );
    const targetName =
      otherPart?.user?.displayName ||
      otherPart?.user?.username ||
      otherPart?.displayName ||
      otherPart?.name ||
      conversation.name;

    if (targetName && targetName !== 'Group' && targetName !== 'Chat') {
      const slug = slugify(targetName);
      if (slug) return slug;
    }
  }

  const groupName = conversation.name || conversation.title || conversation.activityName || 'chat';
  const slug = slugify(groupName);
  return slug || 'chat';
}
