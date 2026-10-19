import { registerDecorator, ValidationOptions } from 'class-validator';
import { countChars } from './text-length.util';

/**
 * Fails when the string is longer than `max` code points (see `countChars`).
 * Non-strings pass: `@IsString()` owns that failure, so a body with a number
 * for `text` gets one message rather than two.
 */
export function MaxChars(max: number, options?: ValidationOptions) {
  return (target: object, propertyName: string): void => {
    registerDecorator({
      name: 'maxChars',
      target: target.constructor,
      propertyName,
      constraints: [max],
      options: {
        message: `Must be ${max} characters or fewer`,
        ...options,
      },
      validator: {
        validate(value: unknown): boolean {
          return typeof value !== 'string' || countChars(value) <= max;
        },
      },
    });
  };
}
