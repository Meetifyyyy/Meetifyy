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

/**
 * The current password, submitted by an already-authenticated caller so the
 * change-password screen can prove they know it.
 *
 * No `@Length` bound beyond the upper one: this is a password being CHECKED,
 * not chosen, and rejecting a short one here would answer "that is not your
 * password" a step earlier than the actual verification does, from a rule
 * rather than from the credential.
 */
export class VerifyPasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  @MaxLength(200, { message: 'Password is too long' })
  password: string;
}

/**
 * The forgot-password screen's single request: look the address up and, if it
 * is real, send the link. Replaces a client-side pair where only the lookup
 * half ever reached this backend.
 */
export class RequestPasswordResetDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty({ message: 'Email address is required' })
  @MaxLength(254, { message: 'Email address is too long' })
  email: string;
}

/**
 * Signup, proxied so it can be rate-limited.
 *
 * The password bound is 200 rather than the 72 the UI enforces: the byte-level
 * bcrypt rule belongs to `passwordRules` on the client and to GoTrue on the
 * far side, and duplicating it here as a character count would produce a third
 * answer that disagrees with both. This bound exists only to stop an unbounded
 * string reaching the hash.
 */
export class SignUpDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty({ message: 'Email address is required' })
  @MaxLength(254, { message: 'Email address is too long' })
  email: string;

  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  @MaxLength(200, { message: 'Password is too long' })
  password: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  username?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  birthday?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;
}

/** Re-send the signup confirmation code to an address mid-signup. */
export class ResendSignupOtpDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty({ message: 'Email address is required' })
  @MaxLength(254, { message: 'Email address is too long' })
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
  /**
   * Optional, because the server does not need the client to tell it who the
   * caller is — `resolveRecipientEmail` falls back to the address on the
   * verified JWT, which is the more trustworthy of the two anyway. Supplying it
   * is still allowed, and still checked against the caller's own address.
   *
   * Required, this blocked the notification for any account whose cached
   * profile had no email (a placeholder address, a sync that had not filled it
   * in yet) — and the client was throwing before it even got here rather than
   * let a password change proceed without one.
   */
  @IsOptional()
  @IsEmail()
  email?: string;

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
