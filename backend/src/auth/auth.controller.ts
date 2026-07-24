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
    const syncedUser = await this.authService.syncProfile(user);
    return {
      message: 'Profile synchronized successfully',
      user: syncedUser,
    };
  }

  @Post('lookup-email')
  async lookupEmail(@Body() body: LookupEmailDto) {
    return this.authService.lookupEmailByUsername(body.username);
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
