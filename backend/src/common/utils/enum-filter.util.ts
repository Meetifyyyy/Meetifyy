import { BadRequestException } from '@nestjs/common';

/**
 * Narrows an enum-valued query-string filter before it reaches Prisma.
 *
 * `@Query('status') status?: SomeEnum` is only a type annotation: the value is
 * whatever string the caller sent. Handed to Prisma as an enum, an unknown one
 * is a validation error and the request fails with a 500. This answers the
 * three cases explicitly:
 *
 *   - absent or `''` (the admin portal's "All") → `undefined`, no filter;
 *   - a member of the enum                      → that member;
 *   - anything else                             → 400, naming the valid values.
 */
export function parseEnumFilter<E extends Record<string, string>>(
  enumObject: E,
  value: string | undefined,
  name: string,
): E[keyof E] | undefined {
  if (value === undefined || value === '') return undefined;
  // Object.values widens to string[]; these are exactly E's members.
  const members = Object.values(enumObject) as E[keyof E][];
  const match = members.find((member) => member === value);
  if (match !== undefined) return match;
  throw new BadRequestException(
    `Invalid ${name} '${value}'. Expected one of: ${members.join(', ')}`,
  );
}
