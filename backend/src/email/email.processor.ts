import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
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

@Processor('email')
export class EmailProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(EmailProcessor.name);
  private resend: Resend;
  private smtpTransporter: nodemailer.Transporter;
  private driver: string;
  private from: string;

  constructor() {
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
        subject = 'Your Meetifyy Verification Code';
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

    const { replyTo, devRedirectTo, fromName } = config.email;
    const rawFrom = job.data.from || this.from;
    const from = rawFrom.includes('<') ? rawFrom : `${fromName} <${rawFrom}>`;
    // Development safety valve: when DEV_EMAIL_REDIRECT is set, mail goes
    // there instead of the real recipient. Always empty in a deployed
    // environment, so production and staging always reach the real address.
    const to = devRedirectTo || job.data.email;

    // Never widened to include `html`, `otp`, `resetLink` or any other body
    // content — those carry one-time codes and reset tokens.
    const context = {
      provider: this.driver,
      jobId: job.id,
      type: job.name,
      to,
      intendedTo: job.data.email,
      redirected: Boolean(devRedirectTo),
      from,
      subject,
    };

    try {
      if (this.driver === 'mailpit' || this.driver === 'smtp') {
        const info = await this.smtpTransporter.sendMail({
          from,
          to,
          subject,
          html,
          ...(replyTo ? { replyTo } : {}),
        });
        this.logger.log(`email.sent ${JSON.stringify({ ...context, messageId: info.messageId, status: 'accepted' })}`);
        return info;
      }

      const { data, error } = await this.resend.emails.send({
        from,
        to,
        subject: subject,
        html: html,
        ...(replyTo ? { replyTo } : {}),
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
      return data;
    } catch (error) {
      this.logger.error(
        `email.send_error ${JSON.stringify({ ...context, status: 'error', error: (error as Error).message })}`,
      );
      // Rethrown so the job is retried and, once retries are exhausted,
      // surfaces through the `failed` worker event above.
      throw error;
    }
  }
}

