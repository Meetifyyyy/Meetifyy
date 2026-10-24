import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { config } from '../config';
import { SUPPORT_EMAIL_JOBS } from './support-email.builder';
import type { EmailJobData } from './email-jobs';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(@InjectQueue('email') private emailQueue: Queue<EmailJobData>) {}

  async sendWelcomeEmail(email: string, name: string) {
    this.logger.log(`Queuing welcome email for ${email}`);
    await this.emailQueue.add('send-welcome-email', { email, name });
  }

  async sendNewLoginEmail(
    email: string,
    name: string,
    device: string,
    location: string,
    time: string,
    browser?: string,
    os?: string,
    ip?: string,
  ) {
    this.logger.log(`Queuing new login email for ${email}`);
    await this.emailQueue.add('send-new-login-email', {
      email,
      name,
      device,
      location,
      time,
      browser,
      os,
      ip,
    });
  }

  async sendResetPasswordEmail(email: string, name: string, resetLink: string) {
    this.logger.log(`Queuing reset password email for ${email}`);
    await this.emailQueue.add('send-reset-password-email', {
      email,
      name,
      resetLink,
    });
  }

  async sendPasswordChangedEmail(
    email: string,
    name: string,
    time?: string,
    device?: string,
    ip?: string,
  ) {
    this.logger.log(`Queuing password changed email for ${email}`);
    await this.emailQueue.add('send-password-changed-email', {
      email,
      name,
      time,
      device,
      ip,
    });
  }

  async sendVerificationOtpEmail(email: string, name: string, otp: string) {
    this.logger.log(`Queuing verification OTP email for ${email}`);
    await this.emailQueue.add('send-verification-otp', { email, name, otp });
  }

  async sendAdminVerificationOtpEmail(
    email: string,
    name: string,
    otp: string,
  ) {
    this.logger.log(`Queuing Super Admin verification OTP email for ${email}`);
    await this.emailQueue.add('send-admin-verification-otp', {
      email,
      name,
      otp,
      from: config.email.securityFrom,
    });
  }

  /**
   * A code proving control of a college address (Campus page). Sent only to
   * that address, from the security sender. The code is never logged.
   */
  async sendCollegeEmailOtp(
    email: string,
    name: string,
    otp: string,
    collegeName?: string,
  ) {
    this.logger.log('Queuing college-email OTP email');
    await this.emailQueue.add('send-college-email-otp', {
      email,
      name,
      otp,
      collegeName,
      from: config.email.securityFrom,
    });
  }

  /** A code proving control of a new personal sign-in address. */
  async sendPersonalEmailOtp(email: string, name: string, otp: string) {
    this.logger.log('Queuing personal-email OTP email');
    await this.emailQueue.add('send-personal-email-otp', {
      email,
      name,
      otp,
      from: config.email.securityFrom,
    });
  }

  async sendReauthCode(email: string, name: string, otp: string) {
    this.logger.log('Queuing reauthentication OTP email');
    await this.emailQueue.add('send-reauth-otp', {
      email,
      name,
      otp,
      from: config.email.securityFrom,
    });
  }

  /**
   * Tells the PREVIOUS sign-in address that it was replaced.
   *
   * Retried with backoff, because this is the one message an owner who did
   * not make the change relies on. `idempotencyKey` (the change's event id)
   * becomes the job id, so enqueueing the same change twice queues one job.
   */
  async sendSignInEmailChangedNotice(
    previousEmail: string,
    name: string,
    newEmailMasked: string,
    idempotencyKey?: string,
  ) {
    this.logger.log('Queuing sign-in email changed notice');
    await this.emailQueue.add(
      'send-signin-email-changed',
      {
        email: previousEmail,
        name,
        newEmailMasked,
        from: config.email.securityFrom,
      },
      {
        ...(idempotencyKey
          ? { jobId: `signin-email-changed:${idempotencyKey}` }
          : {}),
        attempts: 5,
        backoff: { type: 'exponential', delay: 30_000 },
      },
    );
  }

  /**
   * Confirms a request to delete an account.
   *
   * `from` is the security sender, matching the admin access-code email: this
   * is a security-critical action, and it should arrive from the same address
   * a user learns to associate with account safety rather than from the
   * product's general sender.
   */
  async sendAccountDeletionOtpEmail(email: string, name: string, otp: string) {
    // Note the absence of the code from this line. Codes never reach a log.
    this.logger.log(`Queuing account-deletion OTP email for ${email}`);
    await this.emailQueue.add('send-account-deletion-otp', {
      email,
      name,
      otp,
      from: config.email.securityFrom,
    });
  }

  /**
   * Confirms a request to recover an account inside its deletion window.
   *
   * Takes the scheduled deletion date so the email can state how long is left.
   * The date is formatted by the caller from the stored `scheduledPurgeAt`, so
   * this never computes a deadline of its own.
   */
  async sendAccountRecoveryOtpEmail(
    email: string,
    name: string,
    otp: string,
    scheduledDeletionDate?: string,
  ) {
    this.logger.log(`Queuing account-recovery OTP email for ${email}`);
    await this.emailQueue.add('send-account-recovery-otp', {
      email,
      name,
      otp,
      scheduledDeletionDate,
      from: config.email.securityFrom,
    });
  }

  // ── Support desk ─────────────────────────────────────────────────────────
  //
  // These three take a row id rather than the rendered content. The worker
  // loads the ticket itself (see SupportEmailBuilder), which keeps the user's
  // description and the admin's reply out of Redis and means a retried job
  // renders the ticket's current status rather than a stale snapshot.

  /** Confirmation to the person who filed the request. */
  async sendSupportRequestReceivedEmail(ticketId: string) {
    this.logger.log(`Queuing support confirmation for ticket ${ticketId}`);
    await this.emailQueue.add(SUPPORT_EMAIL_JOBS.requestReceived, { ticketId });
  }

  /**
   * An admin's reply. Takes the SupportMessage id so the exact reply that was
   * stored is the one that gets sent — there is no second copy of the text to
   * fall out of step with the thread.
   */
  async sendSupportReplyEmail(messageId: string) {
    this.logger.log(`Queuing support reply email for message ${messageId}`);
    await this.emailQueue.add(SUPPORT_EMAIL_JOBS.reply, { messageId });
  }
}
