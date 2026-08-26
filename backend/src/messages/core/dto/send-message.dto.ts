import {
  IsString,
  IsOptional,
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

export class SendMessageDto {
  @IsString()
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

  @IsBoolean()
  @IsOptional()
  isForwarded?: boolean;

  @IsString()
  @IsOptional()
  forwardedFromMessageId?: string;
}
