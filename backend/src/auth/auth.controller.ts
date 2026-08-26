import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { Request } from 'express';
import { UAParser } from 'ua-parser-js';
import { AuthService } from './auth.service';
import { EmailService } from '../email/email.service';
import { JwtGuard } from '../common/guards/jwt.guard';
import { AuthRateLimitGuard } from '../common/guards/auth-ratelimit.guard';
import { LoginRateLimitGuard } from '../common/guards/login-ratelimit.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  CheckUsernameDto,
  CheckEmailDto,
  LoginDto,
  TriggerWelcomeEmailDto,
  TriggerLoginEmailDto,
  TriggerPasswordChangedEmailDto,
  CreateCollegeRequestDto,
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
      meta: syncedUser.meta || {},
    };
  }

  /**
   * Server-side login proxy. Resolves username→email internally (never returned),
   * authenticates via Supabase, and returns only the session tokens. Brute-force
   * throttled per client IP by LoginRateLimitGuard. The "new login" notification
   * email is fired asynchronously and never blocks the response.
   */
  @Post('login')
  @UseGuards(LoginRateLimitGuard)
  async login(@Body() body: LoginDto, @Req() req: Request) {
    const result = await this.authService.login(body.identifier, body.password);
    // Fire-and-forget — do not block login on the notification email.
    this.sendLoginNotification(
      result.user.email,
      result.user.displayName || result.user.email,
      req,
    ).catch(() => {});
    return result;
  }

  /** Builds device/UA/IP context and queues the new-login email. Never awaited by callers. */
  private async sendLoginNotification(
    email: string,
    name: string,
    req: Request,
  ) {
    const rawUA = (req.headers['user-agent'] as string) || '';
    const parser = new UAParser(rawUA);
    const ua = parser.getResult();

    const browserName = ua.browser?.name || 'Unknown Browser';
    const browserVersion = ua.browser?.major || '';
    const browser = browserVersion
      ? `${browserName} ${browserVersion}`
      : browserName;

    const osName = ua.os?.name || 'Unknown OS';
    const osVersion = ua.os?.version || '';
    const os = osVersion ? `${osName} ${osVersion}` : osName;

    const deviceType = ua.device?.type;
    const deviceModel = ua.device?.model;
    const deviceVendor = ua.device?.vendor;
    let device: string;
    if (deviceModel && deviceVendor) device = `${deviceVendor} ${deviceModel}`;
    else if (deviceType === 'mobile') device = 'Mobile Device';
    else if (deviceType === 'tablet') device = 'Tablet';
    else device = 'Desktop / Laptop';

    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket?.remoteAddress ||
      'Unknown';

    const loginTime = new Date().toLocaleString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });

    await this.emailService.sendNewLoginEmail(
      email,
      name,
      device,
      'Unknown Location',
      loginTime,
      browser,
      os,
      ip,
    );
  }

  @Post('check-username')
  @UseGuards(AuthRateLimitGuard)
  async checkUsername(@Body() body: CheckUsernameDto) {
    return this.authService.checkUsernameAvailability(body.username);
  }

  @Post('check-email')
  @UseGuards(AuthRateLimitGuard)
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
  async triggerLoginEmail(
    @Body() body: TriggerLoginEmailDto,
    @Req() req: Request,
  ) {
    // Parse User-Agent from the request header for accurate device/browser/OS info
    const rawUA = body.userAgent || req.headers['user-agent'] || '';
    const parser = new UAParser(rawUA);
    const uaResult = parser.getResult();

    const browserName = uaResult.browser?.name || 'Unknown Browser';
    const browserVersion = uaResult.browser?.major || '';
    const browser =
      body.browser ||
      (browserVersion ? `${browserName} ${browserVersion}` : browserName);

    const osName = uaResult.os?.name || 'Unknown OS';
    const osVersion = uaResult.os?.version || '';
    const os = body.os || (osVersion ? `${osName} ${osVersion}` : osName);

    const deviceType = uaResult.device?.type;
    const deviceModel = uaResult.device?.model;
    const deviceVendor = uaResult.device?.vendor;
    let device = body.device;
    if (!device) {
      if (deviceModel && deviceVendor) {
        device = `${deviceVendor} ${deviceModel}`;
      } else if (deviceType === 'mobile') {
        device = 'Mobile Device';
      } else if (deviceType === 'tablet') {
        device = 'Tablet';
      } else {
        device = 'Desktop / Laptop';
      }
    }

    // Derive real client IP (Render/proxied environments send x-forwarded-for)
    const ip =
      body.ip ||
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket?.remoteAddress ||
      'Unknown';

    // Format login time in the user's local timezone sent from the browser
    let loginTime: string;
    if (body.time) {
      loginTime = body.time;
    } else {
      const timezone = body.timezone || 'UTC';
      const now = new Date();
      try {
        loginTime = now.toLocaleString('en-US', {
          timeZone: timezone,
          weekday: 'short',
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        });
      } catch {
        // Fallback if timezone string is invalid
        loginTime = now.toLocaleString('en-US', {
          weekday: 'short',
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        });
      }
    }

    await this.emailService.sendNewLoginEmail(
      body.email,
      body.name,
      device,
      body.location || 'Unknown Location',
      loginTime,
      browser,
      os,
      ip,
    );
    return { success: true };
  }

  @Post('events/password-changed')
  @UseGuards(JwtGuard)
  async triggerPasswordChangedEmail(
    @Body() body: TriggerPasswordChangedEmailDto,
    @Req() req: Request,
  ) {
    // Parse device info from User-Agent
    const rawUA = body.device || req.headers['user-agent'] || '';
    const parser = new UAParser(rawUA);
    const uaResult = parser.getResult();

    const browserName = uaResult.browser?.name || 'Unknown Browser';
    const browserVersion = uaResult.browser?.major || '';
    const browser = browserVersion
      ? `${browserName} ${browserVersion}`
      : browserName;

    const deviceType = uaResult.device?.type;
    const deviceModel = uaResult.device?.model;
    const deviceVendor = uaResult.device?.vendor;
    let device: string;
    if (deviceModel && deviceVendor) {
      device = `${deviceVendor} ${deviceModel}`;
    } else if (deviceType === 'mobile') {
      device = `Mobile — ${browser}`;
    } else if (deviceType === 'tablet') {
      device = `Tablet — ${browser}`;
    } else {
      device = `Desktop — ${browser}`;
    }

    // Derive client IP
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket?.remoteAddress ||
      'Unknown';

    // Format timestamp if not provided by the client
    const time =
      body.time ||
      new Date().toLocaleString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });

    await this.emailService.sendPasswordChangedEmail(
      body.email,
      body.name || 'User',
      time,
      device,
      ip,
    );
    return { success: true };
  }

  @Post('request-college')
  async requestCollege(@Body() body: CreateCollegeRequestDto) {
    const request = await this.authService.createCollegeRequest(body);
    return {
      success: true,
      message: 'Campus request submitted successfully',
      request,
    };
  }
}
