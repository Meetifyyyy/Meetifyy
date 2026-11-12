import {
  isUUID,
  registerDecorator,
  type ValidationOptions,
} from 'class-validator';
import { isRecord } from '../../../common/utils/type-guards.util';

/**
 * A user id named in a body: a plain id, or — when `allowObjects` — an object
 * carrying it as `id` or `userId`. An entry that names nothing (an empty string,
 * an object with no id) is skipped, which is what `requestedUserIds` has always
 * done with it, so it is not an error here either.
 */
function isUserReference(entry: unknown, allowObjects: boolean): boolean {
  if (typeof entry === 'string') return !entry || isUUID(entry, 'all');
  if (!allowObjects || !isRecord(entry)) return false;
  const id = entry.id || entry.userId;
  return !id || (typeof id === 'string' && isUUID(id, 'all'));
}

/**
 * The user ids of a start-conversation body, which clients have sent in several
 * shapes: one id, an array of ids, and (`allowObjects`) either of those as
 * `{ id }` / `{ userId }` objects. All stay accepted, because installed apps
 * cannot be updated; what is refused is everything else, an array longer than
 * `max`, and an id that is not a UUID — before any of it reaches a query.
 *
 * `@ArrayMaxSize` cannot do this job: the field is not always an array.
 */
export function IsUserIdReferences(
  options: { max: number; allowObjects: boolean },
  validationOptions?: ValidationOptions,
) {
  return (target: object, propertyName: string): void => {
    registerDecorator({
      name: 'isUserIdReferences',
      target: target.constructor,
      propertyName,
      constraints: [options.max],
      options: {
        message: `${propertyName} must be a user id or a list of at most ${options.max} user ids`,
        ...validationOptions,
      },
      validator: {
        validate(value: unknown): boolean {
          const entries = Array.isArray(value) ? value : [value];
          if (entries.length > options.max) return false;
          return entries.every((entry) =>
            isUserReference(entry, options.allowObjects),
          );
        },
      },
    });
  };
}
