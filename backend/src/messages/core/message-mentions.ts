import type { MentionDto } from '../../common/dto/mention.dto';
import type { SanitizedMention } from '../../mentions/mentions.service';

/**
 * Who a chat message tags, and who hears about it.
 *
 * Mentions belong to group chats only. In a direct chat there is one other
 * person, who already gets the message; a tag there notified them twice and,
 * since the picker searched every account on the platform, offered people who
 * could not even see the chat. Their tags are dropped and nothing is stored.
 *
 * In a group:
 * - a person can be tagged only while they are a member;
 * - `@everyone` tags every current member except the sender. The client sends
 *   it as a mention whose userId is `everyone`, and it counts only where the
 *   text really reads "@everyone" at that span;
 * - a mention notifies only members who have not muted the group. Muted means
 *   no alerts of any kind, mentions included (they used to get through).
 *
 * The stored list (payload.mentions) is what bubbles render: the named members
 * and, if used, one `everyone` entry.
 */
export const EVERYONE = 'everyone';

/** The cap on members one `@everyone` notifies, a bound for very large groups. */
export const EVERYONE_NOTIFY_CAP = 512;

export function isEveryoneMention(
  m: Partial<MentionDto> | null | undefined,
): boolean {
  return Boolean(m) && String(m?.userId || '').toLowerCase() === EVERYONE;
}

/** The `@everyone` span, if the client sent one and the text bears it out. */
export function everyoneSpan(
  text: string,
  raw: MentionDto[] | null | undefined,
): { start: number; end: number } | null {
  if (!text || !Array.isArray(raw)) return null;
  for (const m of raw) {
    if (!isEveryoneMention(m)) continue;
    const { start, end } = m;
    if (!Number.isInteger(start) || !Number.isInteger(end)) continue;
    if (start < 0 || end > text.length || end <= start) continue;
    if (text.slice(start, end).toLowerCase() !== `@${EVERYONE}`) continue;
    // A whole word: not the start of "@everyones" or the tail of "a@everyone".
    if (/\w/.test(text[end] || '') || /\w/.test(text[start - 1] || ''))
      continue;
    return { start, end };
  }
  return null;
}

/** The people the client tagged, without any `everyone` entry. */
export function peopleMentions(
  raw: MentionDto[] | null | undefined,
): MentionDto[] {
  return Array.isArray(raw) ? raw.filter((m) => !isEveryoneMention(m)) : [];
}

/** What is stored on the message: the named members, then `@everyone`, in text order. */
export function storedMentions(
  named: SanitizedMention[],
  everyone: { start: number; end: number } | null,
): SanitizedMention[] {
  const all = everyone
    ? [...named, { userId: EVERYONE, username: EVERYONE, ...everyone }]
    : [...named];
  return all.sort((a, b) => a.start - b.start);
}

/**
 * Who gets a mention notification: the tagged members (or, with `@everyone`,
 * every recipient), only among this message's recipients (no one blocked, no
 * one who left), and never anyone who muted the group.
 */
export function mentionNotifyIds(params: {
  named: string[];
  everyone: boolean;
  recipientIds: string[];
  unmutedRecipientIds: string[];
}): string[] {
  const unmuted = new Set(params.unmutedRecipientIds);
  const recipients = new Set(params.recipientIds);
  const targets = params.everyone
    ? params.recipientIds.slice(0, EVERYONE_NOTIFY_CAP)
    : params.named.filter((id) => recipients.has(id));
  return [...new Set(targets)].filter((id) => unmuted.has(id));
}
