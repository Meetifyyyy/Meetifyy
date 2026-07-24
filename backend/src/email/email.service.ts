import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(@InjectQueue('email') private emailQueue: Queue) {}

  async sendWelcomeEmail(email: string, name: string) {
    this.logger.log(`Queuing welcome email for ${email}`);
    await this.emailQueue.add('send-welcome-email', { email, name });
  }

  async sendNewLoginEmail(email: string, name: string, device: string, location: string, time: string) {
    this.logger.log(`Queuing new login email for ${email}`);
    await this.emailQueue.add('send-new-login-email', { email, name, device, location, time });
  }

  async sendResetPasswordEmail(email: string, name: string, resetLink: string) {
    this.logger.log(`Queuing reset password email for ${email}`);
    await this.emailQueue.add('send-reset-password-email', { email, name, resetLink });
  }

  async sendPasswordChangedEmail(email: string, name: string) {
    this.logger.log(`Queuing password changed email for ${email}`);
    await this.emailQueue.add('send-password-changed-email', { email, name });
  }

  async sendVerificationOtpEmail(email: string, name: string, otp: string) {
    this.logger.log(`Queuing verification OTP email for ${email}`);
    await this.emailQueue.add('send-verification-otp', { email, name, otp });
  }
}
