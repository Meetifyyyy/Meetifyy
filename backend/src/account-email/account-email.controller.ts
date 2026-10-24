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
import { AccountEmailService } from './account-email.service';
import {
  RequestPersonalEmailOtpDto,
  VerifyPersonalEmailDto,
} from './account-email.dto';

/** Settings → Email. See AccountEmailService for the ordering guarantees. */
@UseGuards(JwtGuard)
@Controller('api/account/email')
export class AccountEmailController {
  constructor(private readonly accountEmail: AccountEmailService) {}

  @Get()
  async getStatus(@Req() req: AuthenticatedRequest) {
    return this.accountEmail.getStatus(req.user.id);
  }

  @Post('otp')
  @HttpCode(200)
  @UseGuards(RateLimitPolicyGuard)
  @RateLimit('auth.otp.user', 'auth.otp.ip')
  async requestOtp(
    @Req() req: AuthenticatedRequest,
    @Body() dto: RequestPersonalEmailOtpDto,
  ) {
    return this.accountEmail.requestOtp(req.user.id, dto.email, {
      ip: clientIp(req) || null,
      sessionId: currentSessionId(req),
      reauthToken: dto.reauthToken,
    });
  }

  /**
   * Code attempts are capped per code and per IP (UserOtpService). The legacy
   * password body spends `auth.verifypassword.user` in the service, so a
   * grant-carrying verify does not eat into the password budget.
   */
  @Post('verify')
  @HttpCode(200)
  async verify(
    @Req() req: AuthenticatedRequest,
    @Body() dto: VerifyPersonalEmailDto,
  ) {
    return this.accountEmail.verify(req.user, dto.code, {
      ip: clientIp(req) || null,
      sessionId: currentSessionId(req),
      reauthToken: dto.reauthToken,
      currentPassword: dto.currentPassword,
    });
  }
}
