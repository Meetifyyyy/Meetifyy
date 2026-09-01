/**
 * The slice of the mailer the account-deletion lifecycle needs.
 *
 * Injected by token rather than by importing `EmailService` directly, for two
 * reasons. The narrow one: `EmailService` transitively pulls in `sanitize-html`
 * (via the support-email builder), which ships as ESM and cannot be parsed by
 * the project's Jest transform — so a direct import made every spec that merely
 * touched the deletion service fail to load. The broader one: the deletion flow
 * genuinely needs two methods, and depending on a two-method interface rather
 * than a ten-method class is both easier to stub and honest about the coupling.
 */
export interface AccountMailer {
  sendAccountDeletionOtpEmail(
    email: string,
    name: string,
    otp: string,
  ): Promise<void>;

  sendAccountRecoveryOtpEmail(
    email: string,
    name: string,
    otp: string,
    scheduledDeletionDate?: string,
  ): Promise<void>;
}

/** DI token for {@link AccountMailer}. */
export const ACCOUNT_MAILER = 'ACCOUNT_MAILER';
