import {
  IsString,
  IsOptional,
  MaxLength,
  IsArray,
  IsBoolean,
  IsObject,
  IsNumber,
  Min,
  Max,
  ValidateNested,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MentionDto } from '../../../common/dto/mention.dto';
import {
  MAX_MESSAGE_TEXT_LENGTH,
  MAX_CLIENT_MESSAGE_ID_LENGTH,
} from '../message-limits';

export class SendMessageDto {
  /**
   * Rejected here so an over-long HTTP send fails as a validation error with a
   * field name, rather than reaching the service. It is NOT the enforcement:
   * the socket gateway does not run this pipe, so the authoritative check is
   * `assertMessageTextWithinLimit` inside both sendMessage implementations.
   * Same constant, same raw-length rule, so the two cannot disagree.
   */
  @IsString()
  @MaxLength(MAX_MESSAGE_TEXT_LENGTH)
  @IsOptional()
  text?: string;

  @IsString()
  @IsOptional()
  mediaUrl?: string;

  @IsString()
  @IsOptional()
  mediaType?: string;

  // Lightweight, client-derived media metadata. The global whitelist ValidationPipe
  // strips undeclared fields, so these must be declared to survive to the service.
  @IsString()
  @IsOptional()
  thumbnailUrl?: string;

  @IsNumber()
  @Min(0)
  @Max(20000)
  @IsOptional()
  width?: number;

  @IsNumber()
  @Min(0)
  @Max(20000)
  @IsOptional()
  height?: number;

  @IsNumber()
  @Min(0)
  @Max(86400)
  @IsOptional()
  duration?: number;

  // NOTE: this is a structured mention claim ({userId, username, start, end}),
  // NOT a plain string list — MentionInput on the client always sends this
  // shape. A plain string[] here would make the global ValidationPipe
  // (whitelist + forbidNonWhitelisted) reject every message that includes a
  // mention with a 400, since class-validator would fail each object against
  // @IsString(). MentionsService.sanitize() re-validates every field
  // server-side before anything is trusted.
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => MentionDto)
  @IsOptional()
  mentions?: MentionDto[];

  @IsString()
  @IsOptional()
  replyToId?: string;

  @IsObject()
  @IsOptional()
  inviteData?: any;

  /**
   * The sender's own id for this message, echoed back on the saved one.
   *
   * `MessagesService.sendMessage` has always looked for it — it is the
   * idempotency key, matched against the indexed `clientMessageId` column so a
   * retried send returns the existing message instead of writing a second one.
   * It was never declared here, and the pipe runs `forbidNonWhitelisted`, so
   * every HTTP send that tried to supply one was rejected outright with a 400
   * and every send that did not had no idempotency at all: a flaky connection
   * or a double tap wrote the message twice.
   *
   * It is also what lets a client match its optimistic copy to the saved one.
   * Without it the socket echo of a message whose text is empty — every share,
   * which carries only `inviteData` — could not be matched to the pending copy
   * and appeared alongside it as a duplicate.
   */
  @IsString()
  @IsOptional()
  @MaxLength(MAX_CLIENT_MESSAGE_ID_LENGTH)
  clientId?: string;

  @IsBoolean()
  @IsOptional()
  isForwarded?: boolean;

  @IsString()
  @IsOptional()
  forwardedFromMessageId?: string;
}
