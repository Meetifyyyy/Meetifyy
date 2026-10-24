import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';
import { JwtGuard } from '../common/guards/jwt.guard';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { RateLimitPolicyGuard } from '../common/rate-limit/rate-limit-policy.guard';
import { clientIp } from '../common/rate-limit/client-ip.util';
import { currentSessionId } from '../auth/session/current-session-id';
import { REAUTH_PURPOSES, ReauthService } from './reauth.service';
import {
  ReauthCodeDto,
  ReauthPasswordDto,
  ReauthPurposeDto,
} from './reauth.dto';

/**
 * "Confirm it's you" before changing or removing an email. Each success
 * returns `{ reauthToken, expiresAt }`, spendable once on the named purpose
 * from this session. See ReauthService.
 */
@UseGuards(JwtGuard)
@Controller('api/account/reauth')
export class ReauthController {
  constructor(private readonly reauth: ReauthService) {}

  /** `{ methods: ['password'] | ['email_code'] | [] }` */
  @Get()
  async methods(@Req() req: AuthenticatedRequest) {
    return this.reauth.getMethods(req.user.id);
  }

  /** A password oracle for the signed-in account, so it shares that budget. */
  @Post('password')
  @HttpCode(200)
  @UseGuards(RateLimitPolicyGuard)
  @RateLimit('auth.verifypassword.user')
  async withPassword(
    @Req() req: AuthenticatedRequest,
    @Body() dto: ReauthPasswordDto,
  ) {
    return this.reauth.withPassword(
      req.user,
      REAUTH_PURPOSES[dto.purpose],
      dto.password,
      currentSessionId(req),
    );
  }

  /** Sends mail, so it draws on the OTP send budgets. */
  @Post('code')
  @HttpCode(200)
  @UseGuards(RateLimitPolicyGuard)
  @RateLimit('auth.otp.user', 'auth.otp.ip')
  async sendCode(
    @Req() req: AuthenticatedRequest,
    @Body() dto: ReauthPurposeDto,
  ) {
    return this.reauth.sendCode(req.user, REAUTH_PURPOSES[dto.purpose], {
      ip: clientIp(req) || null,
    });
  }

  /** Per-code attempt ceiling and per-IP verify limit: UserOtpService. */
  @Post('code/verify')
  @HttpCode(200)
  async withCode(@Req() req: AuthenticatedRequest, @Body() dto: ReauthCodeDto) {
    return this.reauth.withCode(
      req.user,
      REAUTH_PURPOSES[dto.purpose],
      dto.code,
      currentSessionId(req),
      { ip: clientIp(req) || null },
    );
  }
}
