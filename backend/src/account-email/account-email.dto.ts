import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { OTP_LENGTH } from '../otp/user-otp.constants';

/** `POST /api/account/email/otp`. */
export class RequestPersonalEmailOtpDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  email!: string;

  /** From `/api/account/reauth`. Optional only for apps that predate it. */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  reauthToken?: string;
}

/**
 * `POST /api/account/email/verify`.
 *
 * Deliberately has NO email field. The address applied is the one the code
 * was bound to when it was sent; with the global pipe's
 * `forbidNonWhitelisted`, a body that tries to name one is refused outright.
 */
export class VerifyPersonalEmailDto {
  @IsString()
  @Length(OTP_LENGTH, OTP_LENGTH, {
    message: `Enter the ${OTP_LENGTH}-digit code from your email.`,
  })
  @Matches(/^\d+$/, {
    message: `Enter the ${OTP_LENGTH}-digit code from your email.`,
  })
  code!: string;

  /**
   * One of these two is required (checked by the service, which answers
   * `reauth_required` without either). `reauthToken` is a grant from
   * `/api/account/reauth`; `currentPassword` is what installed apps that
   * predate grants send, and it is re-checked here at the commit point.
   */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  reauthToken?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  currentPassword?: string;
}
