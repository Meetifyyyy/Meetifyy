import {
  Controller,
  Post,
  Param,
  Body,
  Logger,
  ForbiddenException,
  UseGuards,
} from '@nestjs/common';
import { EmailService } from './email.service';
import { DevEndpointGuard } from '../common/guards/dev-endpoint.guard';
import { config } from '../config';

/**
 * Dev-only controller for triggering email templates via Mailpit.
 * NEVER active in production — gated by config.features.enableDevEndpoints,
 * which is forced off there, both at module registration and per request.
 *
 * Usage (against the configured SMTP target, e.g. a local Mailpit):
 *   POST <BACKEND_URL>/dev/email/test/welcome
 *   POST <BACKEND_URL>/dev/email/test/verification-otp
 *   POST <BACKEND_URL>/dev/email/test/reset-password
 *   POST <BACKEND_URL>/dev/email/test/new-login
 *   POST <BACKEND_URL>/dev/email/test/password-changed
 *   POST <BACKEND_URL>/dev/email/test/admin-otp
 *
 * Body: { "email": "preview@mailpit.local", "name": "Alex" }
 */
@Controller('dev/email/test')
@UseGuards(DevEndpointGuard)
export class DevEmailController {
  private readonly logger = new Logger(DevEmailController.name);

  constructor(private readonly emailService: EmailService) {
    if (!config.features.enableDevEndpoints) {
      throw new Error('DevEmailController must never be loaded in production');
    }
  }

  @Post(':template')
  async trigger(
    @Param('template') template: string,
    @Body() body: Record<string, string>,
  ): Promise<{ ok: boolean; template: string; to: string }> {
    if (!config.features.enableDevEndpoints) {
      throw new ForbiddenException('Dev email endpoint is disabled in production');
    }

    const email = body.email || 'preview@mailpit.local';
    const name = body.name || 'Preview User';

    this.logger.log(`[DEV] Triggering template "${template}" → ${email}`);

    switch (template) {
      case 'welcome':
        await this.emailService.sendWelcomeEmail(email, name);
        break;

      case 'verification-otp':
        await this.emailService.sendVerificationOtpEmail(email, name, '483920');
        break;

      case 'reset-password':
        await this.emailService.sendResetPasswordEmail(
          email,
          name,
          `${config.auth.redirects.resetPasswordUrl}?token=dev-preview-token-abc123`,
        );
        break;

      case 'new-login':
        await this.emailService.sendNewLoginEmail(
          email,
          name,
          'MacBook Pro 16"',
          'Bengaluru, India',
          new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
          'Chrome 126',
          'macOS Sonoma 14.4',
          '103.21.58.142',
        );
        break;

      case 'password-changed':
        await this.emailService.sendPasswordChangedEmail(
          email,
          name,
          new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
          'MacBook Pro 16"',
          '103.21.58.142',
        );
        break;

      case 'admin-otp':
        await this.emailService.sendAdminVerificationOtpEmail(email, name, '739201');
        break;

      default:
        return { ok: false, template, to: email };
    }

    return { ok: true, template, to: email };
  }
}
