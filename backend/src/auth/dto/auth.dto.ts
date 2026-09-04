import {
  IsString,
  IsNotEmpty,
  IsEmail,
  IsOptional,
  Length,
  MaxLength,
} from 'class-validator';

export class CheckUsernameDto {
  @IsString()
  @IsNotEmpty()
  username: string;
}

export class CheckEmailDto {
  /**
   * Validated as a bounded string, not with `@IsEmail`.
   *
   * This endpoint's job is to answer "can I register this address?", and
   * "that is not an address" is one of the answers. With `@IsEmail` here the
   * pipe rejected malformed input with a 400 before the service ever ran, the
   * client could not tell that apart from the network being down, and it
   * therefore told the user their email could not be verified but they could
   * continue anyway. `checkEmailAvailability` now does the format check itself
   * and replies 200 with `code: 'invalid_email'`.
   *
   * The length bound stays: it is what stops an unbounded string reaching the
   * normaliser and the domain lookup.
   */
  @IsString()
  @IsNotEmpty({ message: 'Email address is required' })
  @MaxLength(254, { message: 'Email address is too long' })
  email: string;

  @IsOptional()
  @IsString()
  collegeId?: string;
}

/**
 * "Is there an account for this email?", asked by the forgot-password screen so
 * it can say "No account found" instead of claiming an email was sent.
 */
export class AccountExistsDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty({ message: 'Email address is required' })
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
  @IsString({ message: 'Full name must be a string' })
  @IsNotEmpty({ message: 'Full name is required' })
  @Length(2, 80, { message: 'Full name must be between 2 and 80 characters' })
  name: string;

  @IsString({ message: 'College name must be a string' })
  @IsNotEmpty({ message: 'College name is required' })
  @Length(3, 120, {
    message: 'College name must be between 3 and 120 characters',
  })
  collegeName: string;

  @IsEmail({}, { message: 'College email must be a valid email address' })
  @IsNotEmpty({ message: 'College email is required' })
  @Length(5, 100, {
    message: 'College email must be between 5 and 100 characters',
  })
  collegeEmail: string;

  @IsEmail({}, { message: 'Personal email must be a valid email address' })
  @IsNotEmpty({ message: 'Personal email is required' })
  @Length(5, 100, {
    message: 'Personal email must be between 5 and 100 characters',
  })
  personalEmail: string;
}
