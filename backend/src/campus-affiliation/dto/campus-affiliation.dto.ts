import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { OTP_LENGTH } from '../../otp/user-otp.constants';

/** `POST /api/campus/affiliation/otp`. */
export class RequestCollegeEmailOtpDto {
  @IsUUID()
  collegeId!: string;

  /** Shape is checked by the service's normalizer; this only bounds it. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  email!: string;

  /**
   * A `college_email_change` grant from `/api/account/reauth`. Required by
   * the service for every address after an account's first.
   */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  reauthToken?: string;
}

/**
 * `POST /api/campus/affiliation/verify`.
 *
 * The code, and the reauthentication grant where one is required. The
 * address and college applied are the ones the code was bound to when it was
 * sent, never a value from this body — the global pipe's whitelist strips
 * anything else.
 */
export class VerifyCollegeEmailDto {
  @IsString()
  @Length(OTP_LENGTH, OTP_LENGTH, {
    message: `Enter the ${OTP_LENGTH}-digit code from your email.`,
  })
  @Matches(/^\d+$/, {
    message: `Enter the ${OTP_LENGTH}-digit code from your email.`,
  })
  code!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  reauthToken?: string;
}

/**
 * `DELETE /api/campus/affiliation`. A `college_email_remove` grant, or the
 * password (installed apps that predate grants); the service requires one.
 */
export class RemoveAffiliationDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  reauthToken?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  password?: string;
}

/** `PATCH /admin/users/:id/college-affiliation/revoke`. */
export class RevokeAffiliationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  reason!: string;
}
