import { IsEmail, IsString, MinLength, MaxLength, IsOptional } from 'class-validator';

export class AdminLoginDto {
  @IsEmail({}, { message: 'Valid email required' })
  email: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password: string;
}

export class VerifyOtpDto {
  @IsString()
  pendingToken: string;

  @IsString()
  @MinLength(6)
  @MaxLength(6)
  otp: string;
}

export class VerifyTotpDto {
  @IsString()
  pendingToken: string;

  @IsString()
  totpCode: string;
}

export class ResetPasswordRequestDto {
  @IsEmail()
  email: string;
}

export class ResetPasswordDto {
  @IsString()
  token: string;

  @IsString()
  @MinLength(8)
  newPassword: string;
}
