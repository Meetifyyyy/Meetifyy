import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
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
export class EmailProcessor extends WorkerHost {
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

    this.logger.log(`Email service initialized using driver: [${this.driver}] (SMTP target: ${smtp.host}:${smtp.port})`);
  }

  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.log(`Processing job ${job.id} of type ${job.name} for ${job.data.email}`);

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

    try {
      const { replyTo, devRedirectTo, fromName } = config.email;
      const rawFrom = job.data.from || this.from;
      const from = rawFrom.includes('<') ? rawFrom : `${fromName} <${rawFrom}>`;
      // Development safety valve: when DEV_EMAIL_REDIRECT is set, mail goes
      // there instead of the real recipient. Always empty in production.
      const to = devRedirectTo || job.data.email;

      if (this.driver === 'mailpit' || this.driver === 'smtp') {
        const info = await this.smtpTransporter.sendMail({
          from,
          to,
          subject,
          html,
          ...(replyTo ? { replyTo } : {}),
        });
        this.logger.log(`Successfully dispatched email to Mailpit server for ${job.data.email}. Message ID: ${info.messageId}`);
        return info;
      }

      const { data, error } = await this.resend.emails.send({
        from,
        to,
        subject: subject,
        html: html,
        ...(replyTo ? { replyTo } : {}),
      });

      if (error) {
        this.logger.error(`Failed to send email to ${job.data.email}`, error);
        throw error;
      }

      this.logger.log(`Successfully sent email to ${job.data.email}. Message ID: ${data?.id}`);
      return data;
    } catch (error) {
      this.logger.error(`Error sending email to ${job.data.email}: ${(error as Error).message}`);
      throw error;
    }
  }
}

