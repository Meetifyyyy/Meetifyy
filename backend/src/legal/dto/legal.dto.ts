import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

export class AcknowledgeLegalDto {
  /**
   * The versions the user is accepting.
   *
   * Validated but not trusted: the service intersects this with the versions
   * that are actually required right now, so a stale or forged id records
   * nothing and clears nothing. The cap matches the number of document types —
   * a request naming more than that is malformed by construction.
   */
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(8)
  @IsUUID('4', { each: true })
  versionIds!: string[];
}
