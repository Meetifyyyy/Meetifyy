import { BadRequestException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { isRecord } from '../../common/utils/type-guards.util';
import { MAX_NEW_GROUP_MEMBERS } from './message-limits';

/**
 * The user ids a start-conversation body names in `userIds`.
 *
 * The field reaches the controller as raw JSON: ValidationPipe does not check a
 * parameter typed as an array. Clients send it as an array of ids, an array of
 * `{ id }` / `{ userId }` objects, a single id, or a single such object, and all
 * four are accepted. Entries that name nothing are skipped.
 *
 * An entry that names something other than a string is refused. It used to be
 * passed through to the block check and fail there as a database error (500);
 * dropping it instead would quietly start a conversation with fewer people than
 * were asked for.
 */
export function requestedUserIds(body: unknown): string[] {
  const entries = Array.isArray(body) ? body : [body];
  const ids: string[] = [];
  for (const entry of entries) {
    const id: unknown =
      typeof entry === 'string'
        ? entry
        : isRecord(entry)
          ? entry.id || entry.userId
          : undefined;
    if (!id) continue;
    if (typeof id !== 'string') {
      throw new BadRequestException('userIds must contain user ids');
    }
    ids.push(id);
  }
  return ids;
}

/**
 * The user ids of a start-conversation request that names them in the query
 * string (`?userIds=a,b`) instead of the body.
 *
 * The body's list is checked by `StartConversationDto` (at most
 * MAX_NEW_GROUP_MEMBERS UUIDs), but the query string reached the service as a
 * raw split: a URL could name as many people as fit in it, so the founding
 * fan-out cap did not hold on this form. It now passes the same checks, with
 * the same refusal. Empty entries (`a,,b`, a trailing comma) are skipped.
 */
export function queryUserIds(raw: string): string[] {
  const ids = raw
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '');
  if (
    ids.length > MAX_NEW_GROUP_MEMBERS ||
    !ids.every((id) => isUUID(id, 'all'))
  ) {
    throw new BadRequestException(
      `userIds must be a user id or a list of at most ${MAX_NEW_GROUP_MEMBERS} user ids`,
    );
  }
  return ids;
}
