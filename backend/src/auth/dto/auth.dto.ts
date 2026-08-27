import {
  IsString,
  IsNotEmpty,
  IsEmail,
  IsOptional,
  Length,
} from 'class-validator';

export class CheckUsernameDto {
  @IsString()
  @IsNotEmpty()
  username: string;
}

export class CheckEmailDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty({ message: 'Email address is required' })
  email: string;

  @IsOptional()
  @IsString()
  collegeId?: string;
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
  @IsString({ message: 'Full name must be a string' })
  @IsNotEmpty({ message: 'Full name is required' })
  @Length(2, 80, { message: 'Full name must be between 2 and 80 characters' })
  name: string;

  @IsString({ message: 'College name must be a string' })
  @IsNotEmpty({ message: 'College name is required' })
  @Length(3, 120, { message: 'College name must be between 3 and 120 characters' })
  collegeName: string;

  @IsEmail({}, { message: 'College email must be a valid email address' })
  @IsNotEmpty({ message: 'College email is required' })
  @Length(5, 100, { message: 'College email must be between 5 and 100 characters' })
  collegeEmail: string;

  @IsEmail({}, { message: 'Personal email must be a valid email address' })
  @IsNotEmpty({ message: 'Personal email is required' })
  @Length(5, 100, { message: 'Personal email must be between 5 and 100 characters' })
  personalEmail: string;
}
