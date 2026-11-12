import { IsBoolean } from 'class-validator';

/**
 * `PATCH …/:id/mute`. A boolean, not "truthy": the value is written straight
 * to a boolean column, where a string is a database error rather than a no.
 */
export class MuteConversationDto {
  @IsBoolean()
  muted!: boolean;
}

/** `PATCH …/:id/pin`. */
export class PinConversationDto {
  @IsBoolean()
  pinned!: boolean;
}
