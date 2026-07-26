import { IsString, IsOptional, IsArray, IsBoolean, IsObject } from 'class-validator';

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

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  mentions?: string[];

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
