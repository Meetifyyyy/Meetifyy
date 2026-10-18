/**
 * The slice of the mailer the address-verification flows need (college email
 * on the Campus page, new personal sign-in email).
 *
 * Injected by token for the same reason as `ACCOUNT_MAILER`: importing
 * `EmailService` drags `sanitize-html` (ESM) into a spec's module graph.
 */
export interface AddressMailer {
  sendCollegeEmailOtp(
    email: string,
    name: string,
    otp: string,
    collegeName?: string,
  ): Promise<void>;

  sendPersonalEmailOtp(email: string, name: string, otp: string): Promise<void>;

  /** Notice to the PREVIOUS sign-in address; `newEmailMasked` is masked. */
  sendSignInEmailChangedNotice(
    previousEmail: string,
    name: string,
    newEmailMasked: string,
  ): Promise<void>;
}

/** DI token for {@link AddressMailer}. */
export const ADDRESS_MAILER = 'ADDRESS_MAILER';
