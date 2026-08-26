import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { EmailDeliveryStatus } from '@prisma/client';
import { Job } from 'bullmq';
import { Resend } from 'resend';
import * as nodemailer from 'nodemailer';
import { render } from '@react-email/render';
import { createElement } from 'react';

import { WelcomeEmail } from './templates/welcome';
import { NewLoginEmail } from './templates/new-login';
import { ResetPasswordEmail } from './templates/reset-password';
import { VerificationOtpEmail } from './templates/verification-otp';
import { PasswordChangedEmail } from './templates/password-changed';
import { AdminOtpEmail } from './templates/admin-otp';
import { config } from '../config';
import { PrismaService } from '../prisma/prisma.service';
import {
  BuiltEmail,
  DeliveryTarget,
  SUPPORT_EMAIL_JOBS,
  SupportEmailBuilder,
  SupportEmailJobName,
} from './support-email.builder';

const SUPPORT_JOB_NAMES: string[] = Object.values(SUPPORT_EMAIL_JOBS);

@Processor('email')
export class EmailProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(EmailProcessor.name);
  private resend: Resend;
  private smtpTransporter: nodemailer.Transporter;
  private driver: string;
  private from: string;

  constructor(
    private readonly supportEmails: SupportEmailBuilder,
    private readonly prisma: PrismaService,
  ) {
    super();
    // Driver, credentials, sender and SMTP target are all environment values —
    // the sending logic below is identical in every environment.
    const { driver, smtp, resend, from } = config.email;
    this.driver = driver;
    this.resend = new Resend(resend.apiKey);

    this.smtpTransporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      ...(smtp.user && smtp.pass
        ? {
            auth: {
              user: smtp.user,
              pass: smtp.pass,
            },
          }
        : {}),
      tls: {
        rejectUnauthorized: false,
      },
    });

    this.from = from;

    this.logger.log(
      `email.init ${JSON.stringify({
        // Logged because a deployed box with APP_ENV unset silently falls back
        // to "development", which selects the mailpit driver.
        appEnv: config.app.env,
        queuePrefix: config.redis.queuePrefix,
        provider: this.driver,
        from: this.from,
        replyTo: config.email.replyTo ?? null,
        // A non-empty value here means every recipient is being rewritten.
        devRedirectTo: config.email.devRedirectTo || null,
        smtpTarget: this.driver === 'resend' ? null : `${smtp.host}:${smtp.port}`,
        resendFromDomain: this.driver === 'resend' ? resend.fromDomain : null,
      })}`,
    );
  }

  /**
   * Resend refuses (403) every send from a domain that is not verified on the
   * account. That is a configuration mistake, not a per-message one, so it is
   * checked once at boot — otherwise the only symptom is transactional mail
   * that never arrives while the API keeps answering each job individually.
   */
  async onModuleInit(): Promise<void> {
    if (this.driver !== 'resend') return;

    const { fromDomain } = config.email.resend;
    try {
      const { data, error } = await this.resend.domains.list();
      if (error) {
        this.logger.error(
          `email.domain_check_failed ${JSON.stringify({ provider: 'resend', fromDomain, error: error.message })}`,
        );
        return;
      }

      const domains = (data?.data ?? []) as Array<{ name: string; status: string }>;
      const match = domains.find((entry) => entry.name.toLowerCase() === fromDomain);

      if (!match || match.status !== 'verified') {
        this.logger.error(
          `email.domain_unverified ${JSON.stringify({
            provider: 'resend',
            fromDomain,
            status: match?.status ?? 'not-found',
            verifiedDomains: domains.filter((entry) => entry.status === 'verified').map((entry) => entry.name),
            hint: 'EMAIL_FROM uses a domain that is not verified on this Resend account; every send will fail with 403',
          })}`,
        );
        return;
      }

      this.logger.log(`email.domain_verified ${JSON.stringify({ provider: 'resend', fromDomain })}`);
    } catch (error) {
      // A failed pre-flight must never stop the app from booting.
      this.logger.error(
        `email.domain_check_failed ${JSON.stringify({
          provider: 'resend',
          fromDomain,
          error: (error as Error).message,
        })}`,
      );
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    // Without this, an email job that exhausts its retries disappears: the
    // throw below is caught by BullMQ and never reaches the app log again.
    this.logger.error(
      `email.job_failed ${JSON.stringify({
        provider: this.driver,
        jobId: job?.id ?? null,
        type: job?.name ?? null,
        to: job?.data?.email ?? null,
        attempts: job?.attemptsMade ?? null,
        error: error?.message ?? String(error),
      })}`,
    );
  }

  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.log(
      `email.processing ${JSON.stringify({ provider: this.driver, jobId: job.id, type: job.name, to: job.data.email })}`,
    );

    let html: string;
    let subject: string;
    // Set only by the support path; the legacy templates keep their existing
    // behaviour of taking the recipient and reply-to from the job/global config.
    let plainText: string | undefined;
    let recipientOverride: string | undefined;
    let replyToOverride: string | undefined;
    let deliveryTarget: DeliveryTarget = null;
    let extraLogContext: Record<string, unknown> = {};

    if (SUPPORT_JOB_NAMES.includes(job.name)) {
      const built = await this.supportEmails.build(
        job.name as SupportEmailJobName,
        job.data.ticketId ?? job.data.messageId,
      );

      // Null means the message must not be sent: the row is gone, the internal
      // inbox is unconfigured, or the entry turned out to be an internal note.
      // None of those are retryable, so the job completes rather than throwing
      // itself back onto the queue to fail identically four more times.
      if (!built) {
        this.logger.warn(
          `email.support_build_skipped ${JSON.stringify({ jobId: job.id, type: job.name })}`,
        );
        return { skipped: true };
      }

      ({ subject, html } = built);
      plainText = built.text;
      recipientOverride = built.to;
      replyToOverride = built.replyTo;
      deliveryTarget = built.deliveryTarget;
      extraLogContext = built.logContext;
    } else {
    switch (job.name) {
      case 'send-welcome-email':
        subject = 'Welcome to Meetifyy!';
        html = await render(createElement(WelcomeEmail, { name: job.data.name }));
        break;

      case 'send-new-login-email':
        subject = 'New login to your Meetifyy account';
        html = await render(createElement(NewLoginEmail, { 
          name: job.data.name,
          device: job.data.device,
          location: job.data.location,
          time: job.data.time,
          browser: job.data.browser,
          os: job.data.os,
          ip: job.data.ip,
        }));
        break;

      case 'send-reset-password-email':
        subject = 'Reset Your Password';
        html = await render(createElement(ResetPasswordEmail, {
          name: job.data.name,
          resetLink: job.data.resetLink
        }));
        break;

      case 'send-verification-otp':
        subject = 'Verify your college email';
        html = await render(createElement(VerificationOtpEmail, {
          name: job.data.name,
          otp: job.data.otp
        }));
        break;

      case 'send-admin-verification-otp':
        subject = 'Super Admin Access Code';
        html = await render(createElement(AdminOtpEmail, {
          name: job.data.name,
          otp: job.data.otp
        }));
        break;

      case 'send-password-changed-email':
        subject = 'Your Meetifyy Password Was Changed';
        html = await render(createElement(PasswordChangedEmail, {
          name: job.data.name,
          time: job.data.time,
          device: job.data.device,
          ip: job.data.ip,
        }));
        break;

      default:
        this.logger.error(`Unknown job type: ${job.name}`);
        throw new Error(`Unknown job type: ${job.name}`);
    }
    }

    const { replyTo, devRedirectTo, fromName } = config.email;
    const rawFrom = job.data.from || this.from;
    const from = rawFrom.includes('<') ? rawFrom : `${fromName} <${rawFrom}>`;
    const intendedTo = recipientOverride ?? job.data.email;
    // Development safety valve: when DEV_EMAIL_REDIRECT is set, mail goes
    // there instead of the real recipient. Always empty in a deployed
    // environment, so production and staging always reach the real address.
    const to = devRedirectTo || intendedTo;
    // Support mail leaves reply-to unconfigured or uses explicit override if configured.
    const effectiveReplyTo = replyToOverride ?? replyTo;

    // Never widened to include `html`, `otp`, `resetLink` or any other body
    // content — those carry one-time codes and reset tokens.
    const context = {
      provider: this.driver,
      jobId: job.id,
      type: job.name,
      to,
      intendedTo,
      redirected: Boolean(devRedirectTo),
      from,
      subject,
      ...extraLogContext,
    };

    try {
      if (this.driver === 'mailpit' || this.driver === 'smtp') {
        const info = await this.smtpTransporter.sendMail({
          from,
          to,
          subject,
          html,
          // A text/plain alternative alongside the HTML part: it is what
          // text-only clients render and what several spam filters expect a
          // legitimate multipart message to carry.
          ...(plainText ? { text: plainText } : {}),
          ...(effectiveReplyTo ? { replyTo: effectiveReplyTo } : {}),
        });
        this.logger.log(`email.sent ${JSON.stringify({ ...context, messageId: info.messageId, status: 'accepted' })}`);
        await this.recordDelivery(deliveryTarget, { messageId: info.messageId });
        return info;
      }

      const { data, error } = await this.resend.emails.send({
        from,
        to,
        subject: subject,
        html: html,
        ...(plainText ? { text: plainText } : {}),
        ...(effectiveReplyTo ? { replyTo: effectiveReplyTo } : {}),
      });

      // Resend reports a rejected send in the response body rather than by
      // rejecting the promise, so this branch is the one that used to let an
      // undelivered email look like a successful one.
      if (error) {
        this.logger.error(
          `email.send_failed ${JSON.stringify({
            ...context,
            status: 'rejected',
            errorName: error.name,
            error: error.message,
          })}`,
        );
        // Rethrown as a real Error: the Resend error is a plain object, which
        // BullMQ records without a message or a stack.
        throw new Error(`Resend rejected ${job.name} to ${to}: ${error.name} — ${error.message}`);
      }

      if (!data?.id) {
        this.logger.error(`email.send_failed ${JSON.stringify({ ...context, status: 'no-message-id' })}`);
        throw new Error(`Resend returned no message id for ${job.name} to ${to}`);
      }

      this.logger.log(`email.sent ${JSON.stringify({ ...context, messageId: data.id, status: 'accepted' })}`);
      await this.recordDelivery(deliveryTarget, { messageId: data.id });
      return data;
    } catch (error) {
      this.logger.error(
        `email.send_error ${JSON.stringify({ ...context, status: 'error', error: (error as Error).message })}`,
      );
      // Marked failed on every attempt, not only the last one: an admin
      // watching a ticket should see "not delivered" while the retries are
      // still running, not an ambiguous "pending" that may never resolve. A
      // later successful retry overwrites this with SENT.
      await this.recordDelivery(deliveryTarget, { error: (error as Error).message });
      // Rethrown so the job is retried and, once retries are exhausted,
      // surfaces through the `failed` worker event above.
      throw error;
    }
  }

  /**
   * Writes the send outcome back onto the ticket or the reply.
   *
   * This is what makes delivery status visible in the Admin Dashboard: an
   * admin's reply that was recorded but never reached the user has to be
   * distinguishable from one that did, or the response is silently lost.
   *
   * Never throws. A bookkeeping failure must not turn a delivered email into a
   * failed job, which would then be retried and deliver the message twice.
   */
  private async recordDelivery(target: DeliveryTarget, outcome: { messageId?: string; error?: string }): Promise<void> {
    if (!target) return;

    const failed = Boolean(outcome.error);
    const status = failed ? EmailDeliveryStatus.FAILED : EmailDeliveryStatus.SENT;
    // Truncated: a provider error can be a full HTML response body, and this
    // column is read straight into an admin's browser.
    const emailError = outcome.error ? outcome.error.slice(0, 500) : null;

    try {
      if (target.model === 'supportTicket') {
        await this.prisma.supportTicket.update({
          where: { id: target.id },
          data: { emailStatus: status, emailError },
        });
        return;
      }

      await this.prisma.supportMessage.update({
        where: { id: target.id },
        data: {
          emailStatus: status,
          emailError,
          emailMessageId: outcome.messageId ?? null,
          emailSentAt: failed ? null : new Date(),
        },
      });
    } catch (error) {
      this.logger.error(
        `email.delivery_record_failed ${JSON.stringify({
          model: target.model,
          id: target.id,
          error: (error as Error).message,
        })}`,
      );
    }
  }
}

