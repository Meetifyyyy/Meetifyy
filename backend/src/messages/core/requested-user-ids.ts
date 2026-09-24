import { BadRequestException } from '@nestjs/common';
import { isRecord } from '../../common/utils/type-guards.util';

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
