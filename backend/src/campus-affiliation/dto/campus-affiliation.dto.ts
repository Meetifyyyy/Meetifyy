import {
  IsNotEmpty,
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
}

/**
 * `POST /api/campus/affiliation/verify`.
 *
 * Only the code. The address and college applied are the ones the code was
 * bound to when it was sent, never a value from this body — the global pipe's
 * whitelist strips anything else.
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
}

/** `DELETE /api/campus/affiliation`. */
export class RemoveAffiliationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  password!: string;
}

/** `PATCH /admin/users/:id/college-affiliation/revoke`. */
export class RevokeAffiliationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  reason!: string;
}
