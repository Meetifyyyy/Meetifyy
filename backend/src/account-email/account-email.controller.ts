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
    });
  }

  /** Re-proves the password, so it shares that budget. */
  @Post('verify')
  @HttpCode(200)
  @UseGuards(RateLimitPolicyGuard)
  @RateLimit('auth.verifypassword.user')
  async verify(
    @Req() req: AuthenticatedRequest,
    @Body() dto: VerifyPersonalEmailDto,
  ) {
    return this.accountEmail.verify(req.user, dto.code, dto.currentPassword, {
      ip: clientIp(req) || null,
    });
  }
}
