import { IsInt, IsString, Matches, Min } from 'class-validator';

/**
 * Client-supplied mention claim: "the substring text[start:end] is `@username`,
 * and it refers to userId". Never trusted as-is — MentionsService re-validates
 * every field against the actual text and a DB existence check before anything
 * is persisted or notified. Untrusted indices/usernames here would otherwise let
 * a client spam arbitrary users with mention notifications.
 */
export class MentionDto {
  @IsString()
  userId: string;

  @IsString()
  @Matches(/^[a-zA-Z0-9_.]{1,50}$/)
  username: string;

  @IsInt()
  @Min(0)
  start: number;

  @IsInt()
  @Min(0)
  end: number;
}
