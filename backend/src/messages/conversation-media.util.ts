import { Prisma } from '@prisma/client';
import { payloadFields, stringOrNull } from './core/message-payload';

/**
 * The shared-media gallery of a conversation.
 *
 * The client used to build its gallery from whichever history pages it happened
 * to have loaded, so older attachments were simply absent and "no media" was a
 * statement about the cache rather than the chat. This is the server-side read
 * model that replaces it: it returns only the image and video attachments,
 * newest first, in pages the client can ask for as the gallery needs them.
 */

export const MEDIA_PAGE_DEFAULT = 30;
export const MEDIA_PAGE_MAX = 60;

export type ConversationMediaKind = 'image' | 'video';

export interface ConversationMediaItem {
  /** The message that carries this attachment (the report/delete target). */
  messageId: string;
  senderId: string;
  kind: ConversationMediaKind;
  /** Stored value, exactly as the message holds it; the client signs it. */
  mediaUrl: string;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  createdAt: string;
}

export interface ConversationMediaPage {
  items: ConversationMediaItem[];
  /** Pass back as `before` for the next (older) page; null when exhausted. */
  nextCursor: string | null;
}

/** A row selected for the gallery. */
export interface MediaMessageRow {
  id: string;
  senderId: string;
  createdAt: Date;
  payload: Prisma.JsonValue | null;
}

const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.heic'];
// `.webm` is deliberately absent: voice notes are recorded as webm audio, so the
// extension cannot tell them from a video. A real webm video carries a
// `mediaType` and is selected on that.
const VIDEO_EXT = ['.mp4', '.mov', '.mkv', '.m4v'];

/** Out-of-range, fractional or missing input becomes a safe page size. */
export function clampMediaLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return MEDIA_PAGE_DEFAULT;
  return Math.min(Math.max(Math.trunc(value), 1), MEDIA_PAGE_MAX);
}

/**
 * Which messages are gallery media, decided by the database so a page is full
 * of media rather than "a page of messages, some of which were media".
 *
 * `mediaType` is the primary signal. Older rows predate it, so the stored
 * file's extension is accepted too (see VIDEO_EXT for why `.webm` is not). Voice
 * notes are MEDIA messages as well and stay out: their type is audio, and
 * `toMediaItem` believes an explicit type over an extension.
 */
export function mediaMessageFilter(): Prisma.MessageWhereInput {
  const byType = (prefix: string): Prisma.MessageWhereInput => ({
    payload: { path: ['mediaType'], string_starts_with: prefix },
  });
  const byExtension = (ext: string): Prisma.MessageWhereInput => ({
    payload: { path: ['mediaUrl'], string_ends_with: ext },
  });
  return {
    type: 'MEDIA',
    OR: [
      byType('image'),
      byType('video'),
      ...IMAGE_EXT.map(byExtension),
      ...VIDEO_EXT.map(byExtension),
    ],
  };
}

export type MediaCursor =
  | { kind: 'position'; createdAt: Date; id: string }
  | { kind: 'message'; id: string };

/**
 * `<ISO time>|<id>` seeks by index; a bare id is looked up by the caller.
 * Anything unparseable means "from the newest".
 */
export function parseMediaCursor(
  cursor: string | undefined,
): MediaCursor | null {
  if (typeof cursor !== 'string' || cursor === '') return null;
  if (cursor.includes('|')) {
    const [dateStr, id] = cursor.split('|');
    const createdAt = new Date(dateStr);
    if (id && !Number.isNaN(createdAt.getTime())) {
      return { kind: 'position', createdAt, id };
    }
    return null;
  }
  return { kind: 'message', id: cursor };
}

export function buildMediaCursor(
  row: Pick<MediaMessageRow, 'id' | 'createdAt'>,
): string {
  return `${row.createdAt.toISOString()}|${row.id}`;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function kindOf(
  mediaType: string | null,
  mediaUrl: string,
): ConversationMediaKind | null {
  const type = (mediaType ?? '').toLowerCase();
  // An explicit type is believed: audio stays out whatever its extension says.
  if (type !== '') {
    if (type.startsWith('video')) return 'video';
    if (type.startsWith('image')) return 'image';
    return null;
  }
  const path = mediaUrl.split('?')[0].split('#')[0].toLowerCase();
  if (VIDEO_EXT.some((ext) => path.endsWith(ext))) return 'video';
  if (IMAGE_EXT.some((ext) => path.endsWith(ext))) return 'image';
  return null;
}

/** The gallery item for a row, or null when it turns out not to be shown media. */
export function toMediaItem(
  row: MediaMessageRow,
): ConversationMediaItem | null {
  const fields = payloadFields(row.payload);
  const mediaUrl = stringOrNull(fields.mediaUrl);
  if (!mediaUrl) return null;
  const kind = kindOf(stringOrNull(fields.mediaType), mediaUrl);
  if (!kind) return null;
  return {
    messageId: row.id,
    senderId: row.senderId,
    kind,
    mediaUrl,
    thumbnailUrl: stringOrNull(fields.thumbnailUrl),
    width: numberOrNull(fields.width),
    height: numberOrNull(fields.height),
    duration: numberOrNull(fields.duration),
    createdAt: row.createdAt.toISOString(),
  };
}
