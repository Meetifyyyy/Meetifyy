import {
  IsIn,
  IsNotEmpty,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { OTP_LENGTH } from '../otp/user-otp.constants';
import { REAUTH_PURPOSES, type ReauthPurposeName } from './reauth.service';

const PURPOSE_NAMES = Object.keys(REAUTH_PURPOSES);

/** `POST /api/account/reauth/code`. */
export class ReauthPurposeDto {
  @IsIn(PURPOSE_NAMES)
  purpose!: ReauthPurposeName;
}

/** `POST /api/account/reauth/password`. */
export class ReauthPasswordDto extends ReauthPurposeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  password!: string;
}

/** `POST /api/account/reauth/code/verify`. */
export class ReauthCodeDto extends ReauthPurposeDto {
  @IsString()
  @Length(OTP_LENGTH, OTP_LENGTH, {
    message: `Enter the ${OTP_LENGTH}-digit code from your email.`,
  })
  @Matches(/^\d+$/, {
    message: `Enter the ${OTP_LENGTH}-digit code from your email.`,
  })
  code!: string;
}
