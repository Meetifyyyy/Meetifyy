import { plainToInstance } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  validateSync,
} from 'class-validator';
import { SendMessageDto } from '../messages/core/dto/send-message.dto';
import { MAX_REFERENCE_ID_LENGTH } from '../messages/core/message-limits';

/**
 * Validation for socket event payloads.
 *
 * The global ValidationPipe only runs for HTTP, so every socket payload
 * arrived as whatever the client sent. A declared `{ conversationId: string }`
 * validated nothing: an object there reached Prisma as a filter, not an id.
 * Handlers parse with `parseSocketPayload` instead of a pipe because this
 * gateway answers with an ack (`{ status: 'error', … }`) and a pipe would throw
 * past it, leaving the client waiting for a reply that never comes.
 */

/** Any event that names one conversation, by internal or public id. */
export class ConversationRefPayload {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_REFERENCE_ID_LENGTH)
  conversationId!: string;
}

/** `message:delivered` / `message:received`. */
export class DeliveryReceiptPayload extends ConversationRefPayload {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_REFERENCE_ID_LENGTH)
  messageId!: string;
}

/** `messages:seen` / `conversation:mark_seen`. */
export class SeenPayload extends ConversationRefPayload {
  @IsOptional()
  @IsString()
  @MaxLength(MAX_REFERENCE_ID_LENGTH)
  lastMessageId?: string;
}

/**
 * `message:send`: the HTTP route's DTO, so both transports accept exactly the
 * same message. The conversation is in the payload here rather than the URL,
 * so it is required.
 */
export class SocketSendMessagePayload extends SendMessageDto {}

/** `message:catchup`: the client's last sync time, an ISO timestamp. */
export class CatchupPayload {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  since!: string;
}

/** `post:join` / `post:leave`. */
export class PostRoomPayload {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_REFERENCE_ID_LENGTH)
  postId!: string;
}

/** `activity:join` / `activity:leave`. */
export class ActivityRoomPayload {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_REFERENCE_ID_LENGTH)
  activityId!: string;
}

/** `community:join_room` / `community:leave_room`. */
export class CommunityRoomPayload {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_REFERENCE_ID_LENGTH)
  communityId!: string;
}

/**
 * The most ids one `conversation:join_rooms` may name. The client's global
 * sync sends every loaded conversation under up to three aliases (id, public
 * id, internal id), so this is set well above any real list rather than near
 * one: refusing a heavy user's sync would silently stop their realtime.
 */
export const MAX_JOIN_ROOMS = 1000;

/** `conversation:join_rooms`. */
export class JoinRoomsPayload {
  @IsArray()
  @ArrayMaxSize(MAX_JOIN_ROOMS)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(MAX_REFERENCE_ID_LENGTH, { each: true })
  conversationIds!: string[];
}

/** The ack for a payload that failed validation. */
export const INVALID_PAYLOAD = {
  status: 'error' as const,
  error: 'Invalid payload',
};

export type ParsedPayload<T> =
  { ok: true; value: T } | { ok: false; errors: string[] };

/**
 * Validates `raw` as `cls`. Unknown fields are dropped (whitelist) rather than
 * refused, because installed apps may send fields newer servers no longer
 * read; wrong types, empty ids and oversized values are refused.
 */
export function parseSocketPayload<T extends object>(
  cls: new () => T,
  raw: unknown,
): ParsedPayload<T> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ['payload must be an object'] };
  }
  const value = plainToInstance(cls, raw);
  const errors = validateSync(value, {
    whitelist: true,
    forbidUnknownValues: true,
  });
  if (errors.length > 0) {
    return {
      ok: false,
      errors: errors.flatMap((e) => Object.values(e.constraints ?? {})),
    };
  }
  return { ok: true, value };
}

/** A client-chosen correlation id echoed in an ack, if it is a string. */
export function correlationIdOf(raw: unknown): string | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { clientId, tempId } = raw as { clientId?: unknown; tempId?: unknown };
  if (typeof clientId === 'string' && clientId) return clientId;
  return typeof tempId === 'string' && tempId ? tempId : undefined;
}
