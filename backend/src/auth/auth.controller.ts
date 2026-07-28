import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { EmailService } from '../email/email.service';
import { JwtGuard } from '../common/guards/jwt.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  CheckUsernameDto,
  CheckEmailDto,
  LookupEmailDto,
  TriggerWelcomeEmailDto,
  TriggerLoginEmailDto,
  TriggerPasswordChangedEmailDto,
} from './dto/auth.dto';

@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly emailService: EmailService,
  ) {}

  @Post('sync')
  @UseGuards(JwtGuard)
  async syncProfile(@CurrentUser() user: { id: string; email: string }) {
    // Bundle bookmark IDs alongside profile sync — eliminates 2 extra frontend requests
    const [syncedUser, postBookmarks, activityBookmarks] = await Promise.all([
      this.authService.syncProfile(user),
      this.authService.getPostBookmarkIds(user.id),
      this.authService.getActivityBookmarkIds(user.id),
    ]);
    return {
      message: 'Profile synchronized successfully',
      user: syncedUser,
      meta: {
        postBookmarkIds: postBookmarks,
        activityBookmarkIds: activityBookmarks,
      },
    };
  }

  @Post('lookup-email')
  async lookupEmail(@Body() body: LookupEmailDto) {
    return this.authService.lookupEmailByUsername(body.username);
  }

  /**
   * Used by the forgot-password flow to check if an account exists before
   * triggering a Supabase reset email.
   *
   * Security: Always returns HTTP 200 with the same body regardless of whether
   * an account exists. This prevents user enumeration — an attacker cannot
   * determine if an email is registered by observing the response.
   *
   * The backend still performs the lookup internally so that it can log the
   * attempt for audit purposes, but the HTTP response is always identical.
   */
  @Post('verify-reset-email')
  async verifyResetEmail(@Body() body: CheckEmailDto) {
    // Silently checks — never throws, never reveals existence
    await this.authService.checkExistsForReset(body.email);
    // Always return the same response — no enumeration possible
    return { sent: true };
  }

  @Post('check-username')
  async checkUsername(@Body() body: CheckUsernameDto) {
    return this.authService.checkUsernameAvailability(body.username);
  }

  @Post('check-email')
  async checkEmail(@Body() body: CheckEmailDto) {
    return this.authService.checkEmailAvailability(body.email);
  }

  @Post('events/welcome')
  @UseGuards(JwtGuard)
  async triggerWelcomeEmail(@Body() body: TriggerWelcomeEmailDto) {
    await this.emailService.sendWelcomeEmail(body.email, body.name);
    return { success: true };
  }

  @Post('events/login')
  @UseGuards(JwtGuard)
  async triggerLoginEmail(@Body() body: TriggerLoginEmailDto) {
    await this.emailService.sendNewLoginEmail(
      body.email,
      body.name,
      body.device || 'Unknown Device',
      body.location || 'Unknown Location',
      body.time || new Date().toLocaleString(),
    );
    return { success: true };
  }

  @Post('events/password-changed')
  @UseGuards(JwtGuard)
  async triggerPasswordChangedEmail(@Body() body: TriggerPasswordChangedEmailDto) {
    await this.emailService.sendPasswordChangedEmail(body.email, body.name || 'User');
    return { success: true };
  }
}
