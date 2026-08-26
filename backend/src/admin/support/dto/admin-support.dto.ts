import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  SupportCategory,
  SupportPriority,
  SupportStatus,
} from '@prisma/client';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const toInt = ({ value }: { value: unknown }) =>
  value === undefined || value === '' ? undefined : Number(value);

/**
 * Every admin mutation goes through one of these.
 *
 * Status and priority are `@IsEnum` rather than free strings on purpose: the
 * requirement is that both stay backend-enforced, so an arbitrary value posted
 * from a modified client is rejected by validation before it can reach a query.
 */

export class ListSupportTicketsDto {
  @IsOptional() @IsEnum(SupportStatus) status?: SupportStatus;
  @IsOptional() @IsEnum(SupportCategory) category?: SupportCategory;
  @IsOptional() @IsEnum(SupportPriority) priority?: SupportPriority;

  /** `unassigned` is a distinct filter, not the absence of one. */
  @IsOptional() @IsString() @MaxLength(60) assignedAdminId?: string;

  /** Matches a request ID, an email address or a subject. */
  @IsOptional() @Transform(trim) @IsString() @MaxLength(200) search?: string;

  @IsOptional() @IsIn(['newest', 'oldest', 'updated', 'priority']) sort?:
    'newest' | 'oldest' | 'updated' | 'priority';

  @IsOptional() @Transform(toInt) @IsInt() @Min(1) page?: number;
  @IsOptional() @Transform(toInt) @IsInt() @Min(1) limit?: number;
}

export class UpdateTicketStatusDto {
  @IsEnum(SupportStatus, { message: 'Unknown ticket status' })
  status: SupportStatus;
}

export class UpdateTicketPriorityDto {
  @IsEnum(SupportPriority, { message: 'Unknown priority' })
  priority: SupportPriority;
}

export class AssignTicketDto {
  /**
   * Null clears the assignment. A uuid is required otherwise - the admin is
   * looked up before the write, so an unknown id is a 404 rather than a
   * dangling reference.
   */
  @IsOptional()
  @IsUUID('4', { message: 'Unknown administrator' })
  adminId?: string | null;
}

export class AddInternalNoteDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  body: string;
}

export class SendReplyDto {
  /** Rich text from the admin editor. Sanitized server-side before storage. */
  @IsString()
  @MinLength(1, { message: 'Write a reply before sending' })
  @MaxLength(50000)
  body: string;

  /**
   * Optional status to apply with the reply, so "answer and mark resolved" is
   * one action and one email rather than two - the email then reports the
   * status the admin actually intended the user to see.
   */
  @IsOptional()
  @IsEnum(SupportStatus)
  status?: SupportStatus;

  /**
   * A note recorded alongside the reply but never sent. Kept on the same
   * request so an admin cannot send the reply and then lose the note to a
   * failed second call.
   */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(10000)
  internalNote?: string;
}

export class PreviewReplyDto {
  @IsString()
  @MaxLength(50000)
  body: string;

  @IsOptional()
  @IsEnum(SupportStatus)
  status?: SupportStatus;
}

export class ReorderItemDto {
  @IsString() @MaxLength(60) id: string;
  @IsInt() @Min(0) sortOrder: number;
}

export class ReorderDto {
  @IsArray()
  // Reordering is a whole-list operation from a drag-and-drop UI; a payload
  // larger than this is not something the UI can produce.
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ReorderItemDto)
  items: ReorderItemDto[];
}
