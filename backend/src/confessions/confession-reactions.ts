import { ConfessionReactionType } from '@prisma/client';

/**
 * The reactions a confession can get, in the order the picker shows them.
 * The wire uses these lower-case keys; the database uses the enum.
 */
export const CONFESSION_REACTIONS = [
  'love',
  'funny',
  'sad',
  'surprised',
  'relatable',
] as const;

export type ConfessionReactionKey = (typeof CONFESSION_REACTIONS)[number];

/** Per-kind totals. Every key is present, zero when nobody chose it. */
export type ReactionCounts = Record<ConfessionReactionKey, number>;

const TYPE_OF: Record<ConfessionReactionKey, ConfessionReactionType> = {
  love: ConfessionReactionType.LOVE,
  funny: ConfessionReactionType.FUNNY,
  sad: ConfessionReactionType.SAD,
  surprised: ConfessionReactionType.SURPRISED,
  relatable: ConfessionReactionType.RELATABLE,
};

const KEY_OF: Record<ConfessionReactionType, ConfessionReactionKey> = {
  LOVE: 'love',
  FUNNY: 'funny',
  SAD: 'sad',
  SURPRISED: 'surprised',
  RELATABLE: 'relatable',
};

export function reactionTypeOf(
  key: ConfessionReactionKey,
): ConfessionReactionType {
  return TYPE_OF[key];
}

export function reactionKeyOf(
  type: ConfessionReactionType,
): ConfessionReactionKey {
  return KEY_OF[type];
}

const KEY_OF_TEXT: Record<string, ConfessionReactionKey> = KEY_OF;

/**
 * The key for an enum value read back as text from raw SQL, or null for one
 * this build does not know (an enum value added by a later release).
 */
export function reactionKeyFromText(
  text: string,
): ConfessionReactionKey | null {
  return Object.hasOwn(KEY_OF_TEXT, text) ? KEY_OF_TEXT[text] : null;
}

export function emptyReactionCounts(): ReactionCounts {
  return { love: 0, funny: 0, sad: 0, surprised: 0, relatable: 0 };
}

/** Sum of every kind. */
export function totalReactions(counts: ReactionCounts): number {
  return CONFESSION_REACTIONS.reduce((sum, key) => sum + counts[key], 0);
}
