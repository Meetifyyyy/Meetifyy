import {
  Controller,
  Post,
  Body,
  UseGuards,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { Request } from 'express';
import { UAParser } from 'ua-parser-js';
import { AuthService } from './auth.service';
import { EmailService } from '../email/email.service';
import { JwtGuard } from '../common/guards/jwt.guard';
import { AllowSuspended } from '../common/decorators/allow-suspended.decorator';
import { AllowPendingDeletion } from '../common/decorators/allow-pending-deletion.decorator';
import { AuthRateLimitGuard } from '../common/guards/auth-ratelimit.guard';
import {
  LoginRateLimitGuard,
  loginAccountKey,
} from '../common/guards/login-ratelimit.guard';
import { RateLimitService } from '../common/rate-limit/rate-limit.service';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { clientIp } from '../common/rate-limit/client-ip.util';
import { RateLimitPolicyGuard } from '../common/rate-limit/rate-limit-policy.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-request';
import {
  CheckUsernameDto,
  CheckEmailDto,
  AccountExistsDto,
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
    private readonly rateLimit: RateLimitService,
  ) {}

  /**
   * The client's own profile, and the route that tells it which screen to show.
   *
   * Reachable in BOTH restricted states, and that is load-bearing rather than a
   * convenience. `accountStatus` travels in this payload, and it is the only
   * thing the suspension and deletion gates key off — so refusing this route
   * for a restricted account means the client never learns it is restricted.
   * The observed failure: a user signed in during their 30-day deletion window,
   * sync came back 403, `currentUser` stayed null, and the recovery screen
   * never mounted. They were left signed in to an app with no profile and no
   * explanation, unable to reach the Recover button at all. Suspended accounts
   * had the same fault for the same reason.
   *
   * Widening the gate by exactly this one route is safe: it returns the
   * caller's own profile and nothing else, which is precisely what the screen
   * that refuses them needs in order to render.
   */
  @Post('sync')
  @UseGuards(JwtGuard)
  @AllowSuspended()
  @AllowPendingDeletion()
  async syncProfile(@CurrentUser() user: AuthenticatedUser) {
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
    let result: Awaited<ReturnType<typeof this.authService.login>>;
    try {
      result = await this.authService.login(body.identifier, body.password);
    } catch (error) {
      // Only failures spend the per-account budget. LoginRateLimitGuard has
      // already checked it on the way in; this is where the point is actually
      // charged, so a user cannot exhaust their own budget by signing in
      // successfully. Never awaited in a way that could change the error the
      // caller sees.
      const account = loginAccountKey(req);
      if (account) {
        await this.rateLimit.penalize('auth.login.account', account);
      }
      throw error;
    }

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

    // `req.ip` rather than the raw header: this address is shown to the user in
    // a security email, and the leftmost X-Forwarded-For entry is whatever the
    // caller wrote — so an attacker could make the "new login from…" notice
    // display any address they liked.
    const ip = clientIp(req) || 'Unknown';

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
    return this.authService.checkEmailAvailability(body.email, body.collegeId);
  }

  /**
   * Backs the forgot-password screen's "No account found" message.
   *
   * Separate from `check-email`, which answers the signup question ("may I
   * register this?") and folds college-domain gating into its reply. A password
   * reset does not care which college an address belongs to, only whether there
   * is an account behind it, and conflating the two would have the reset screen
   * telling people to use their official college email.
   *
   * Rate-limited like the other unauthenticated lookups, which is what stops it
   * being usable to enumerate addresses in bulk.
   */
  @Post('account-exists')
  @UseGuards(AuthRateLimitGuard)
  async accountExists(@Body() body: AccountExistsDto) {
    return this.authService.accountExistsForEmail(body.email);
  }

  @Post('events/welcome')
  @UseGuards(JwtGuard, RateLimitPolicyGuard)
  @RateLimit('auth.emailtrigger.user')
  async triggerWelcomeEmail(
    @Body() body: TriggerWelcomeEmailDto,
    @CurrentUser() user: { id: string; email: string },
  ) {
    const recipientEmail = this.resolveRecipientEmail(user, body.email);
    await this.emailService.sendWelcomeEmail(recipientEmail, body.name);
    return { success: true };
  }

  @Post('events/login')
  @UseGuards(JwtGuard, RateLimitPolicyGuard)
  @RateLimit('auth.emailtrigger.user')
  async triggerLoginEmail(
    @Body() body: TriggerLoginEmailDto,
    @Req() req: Request,
    @CurrentUser() user: { id: string; email: string },
  ) {
    const recipientEmail = this.resolveRecipientEmail(user, body.email);

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

    // Resolved from req.ip (see trust proxy in main.ts), not from the raw
    // header, whose leftmost entry is supplied by the caller.
    const ip =
      body.ip ||
      clientIp(req) ||
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
      recipientEmail,
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
  @UseGuards(JwtGuard, RateLimitPolicyGuard)
  @RateLimit('auth.emailtrigger.user')
  async triggerPasswordChangedEmail(
    @Body() body: TriggerPasswordChangedEmailDto,
    @Req() req: Request,
    @CurrentUser() user: { id: string; email: string },
  ) {
    const recipientEmail = this.resolveRecipientEmail(user, body.email);

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
    // `req.ip` rather than the raw header: this address is shown to the user in
    // a security email, and the leftmost X-Forwarded-For entry is whatever the
    // caller wrote — so an attacker could make the "new login from…" notice
    // display any address they liked.
    const ip = clientIp(req) || 'Unknown';

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
        second: '2-digit',
        hour12: true,
      });

    await this.emailService.sendPasswordChangedEmail(
      recipientEmail,
      body.name || 'User',
      time,
      device,
      ip,
    );
    return { success: true };
  }

  /**
   * Resolves and verifies that transactional emails are strictly dispatched
   * to the authenticated caller's verified address, preventing arbitrary email spoofing.
   */
  private resolveRecipientEmail(
    user: { id: string; email: string },
    suppliedEmail?: string,
  ): string {
    const userEmail = user?.email?.toLowerCase()?.trim();
    const isFallback = !userEmail || userEmail.endsWith('@meetifyy.user');

    if (suppliedEmail) {
      const cleanSupplied = suppliedEmail.toLowerCase().trim();
      if (!isFallback && cleanSupplied !== userEmail) {
        throw new ForbiddenException(
          'Cannot trigger email notification for an arbitrary recipient',
        );
      }
      return cleanSupplied;
    }

    if (isFallback) {
      throw new ForbiddenException('No verified recipient email address found');
    }

    return userEmail;
  }

  @Post('request-college')
  @UseGuards(RateLimitPolicyGuard)
  @RateLimit('auth.collegerequest.ip', 'auth.collegerequest.email')
  async requestCollege(@Body() body: CreateCollegeRequestDto) {
    const request = await this.authService.createCollegeRequest(body);
    return {
      success: true,
      message: 'Campus request submitted successfully',
      request,
    };
  }
}
