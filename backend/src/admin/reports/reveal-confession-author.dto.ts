import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Why a moderator needs to see who wrote an anonymous confession. Stored in
 * the audit log, so it is trimmed (a run of spaces is not a reason) and
 * bounded.
 */
export class RevealConfessionAuthorDto {
  @Transform(trim)
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;
}
