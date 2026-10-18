import {
  Body,
  Controller,
  Delete,
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
import { CampusAffiliationService } from './campus-affiliation.service';
import {
  RemoveAffiliationDto,
  RequestCollegeEmailOtpDto,
  VerifyCollegeEmailDto,
} from './dto/campus-affiliation.dto';

/**
 * The Campus page's college-email verification. Deliberately NOT selfie-gated:
 * verifying a college email is how an account gets campus access in the first
 * place. See docs/college-affiliation.md.
 */
@UseGuards(JwtGuard)
@Controller('api/campus/affiliation')
export class CampusAffiliationController {
  constructor(private readonly affiliation: CampusAffiliationService) {}

  @Get()
  async getStatus(@Req() req: AuthenticatedRequest) {
    return this.affiliation.getStatus(req.user.id);
  }

  /**
   * Sends mail, so it draws on the same per-user and per-IP code budgets as
   * the account-deletion codes. The per-(user, purpose) cooldown and hourly
   * cap live in UserOtpService.
   */
  @Post('otp')
  @HttpCode(200)
  @UseGuards(RateLimitPolicyGuard)
  @RateLimit('auth.otp.user', 'auth.otp.ip')
  async requestOtp(
    @Req() req: AuthenticatedRequest,
    @Body() dto: RequestCollegeEmailOtpDto,
  ) {
    return this.affiliation.requestOtp(
      req.user.id,
      { collegeId: dto.collegeId, email: dto.email },
      { ip: clientIp(req) || null },
    );
  }

  /** Per-code attempt ceiling and per-IP verify limit: UserOtpService. */
  @Post('verify')
  @HttpCode(200)
  async verify(
    @Req() req: AuthenticatedRequest,
    @Body() dto: VerifyCollegeEmailDto,
  ) {
    return this.affiliation.verify(req.user.id, dto.code, {
      ip: clientIp(req) || null,
    });
  }

  /** Re-proves the password, so a borrowed session cannot release the address. */
  @Delete()
  @UseGuards(RateLimitPolicyGuard)
  @RateLimit('auth.verifypassword.user')
  async remove(
    @Req() req: AuthenticatedRequest,
    @Body() dto: RemoveAffiliationDto,
  ) {
    return this.affiliation.remove(req.user, dto.password);
  }
}
