import { IsString, IsNotEmpty, IsEmail, IsOptional, Length } from 'class-validator';

export class CheckUsernameDto {
  @IsString()
  @IsNotEmpty()
  username: string;
}

export class CheckEmailDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;
}

export class LoginDto {
  // Username or email — resolved to an email server-side, never echoed back.
  @IsString()
  @IsNotEmpty()
  identifier: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}

export class TriggerWelcomeEmailDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  name: string;
}

export class TriggerLoginEmailDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  device?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  time?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsString()
  userAgent?: string;

  @IsOptional()
  @IsString()
  browser?: string;

  @IsOptional()
  @IsString()
  os?: string;

  @IsOptional()
  @IsString()
  ip?: string;
}

export class TriggerPasswordChangedEmailDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  time?: string;

  @IsOptional()
  @IsString()
  device?: string;

  @IsOptional()
  @IsString()
  ip?: string;
}

export class CreateCollegeRequestDto {
  @IsString()
  @IsNotEmpty()
  @Length(2, 80)
  name: string;

  @IsString()
  @IsNotEmpty()
  @Length(3, 120)
  collegeName: string;

  @IsEmail()
  @IsNotEmpty()
  @Length(5, 100)
  collegeEmail: string;

  @IsEmail()
  @IsNotEmpty()
  @Length(5, 100)
  personalEmail: string;
}
