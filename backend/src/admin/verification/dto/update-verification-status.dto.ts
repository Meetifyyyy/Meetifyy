import { VerificationStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Longest reviewer note. The service keeps at most this much as the request's
 * `rejectionReason`, and the review screen's textarea stops here too.
 */
export const MAX_VERIFICATION_NOTES_LENGTH = 500;

/** `PATCH /admin/verification/requests/:id/status`. */
export class UpdateVerificationStatusDto {
  @IsEnum(VerificationStatus)
  status!: VerificationStatus;

  /** Shown to the user when a request is rejected or sent back. */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_VERIFICATION_NOTES_LENGTH)
  adminNotes?: string;
}
