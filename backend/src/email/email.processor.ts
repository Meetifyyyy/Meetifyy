import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { Resend } from 'resend';
import { render } from '@react-email/render';
import { createElement } from 'react';

import { WelcomeEmail } from './templates/welcome';
import { NewLoginEmail } from './templates/new-login';
import { ResetPasswordEmail } from './templates/reset-password';
import { VerificationOtpEmail } from './templates/verification-otp';
import { PasswordChangedEmail } from './templates/password-changed';

@Processor('email')
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);
  private resend: Resend;
  private fromEmail: string;

  constructor(private configService: ConfigService) {
    super();
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    this.resend = new Resend(apiKey);
    this.fromEmail = this.configService.get<string>('EMAIL_FROM') || 'onboarding@resend.dev';
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
          time: job.data.time
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

      case 'send-password-changed-email':
        subject = 'Your Meetifyy Password Was Changed';
        html = await render(createElement(PasswordChangedEmail, {
          name: job.data.name
        }));
        break;

      default:
        this.logger.error(`Unknown job type: ${job.name}`);
        throw new Error(`Unknown job type: ${job.name}`);
    }

    try {
      const { data, error } = await this.resend.emails.send({
        from: this.fromEmail,
        to: job.data.email,
        subject: subject,
        html: html,
        replyTo: this.configService.get<string>('EMAIL_REPLY_TO'),
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
