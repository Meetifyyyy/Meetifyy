import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { IsString, Length, Matches } from 'class-validator';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';

import { JwtGuard } from '../common/guards/jwt.guard';
import { AllowPendingDeletion } from '../common/decorators/allow-pending-deletion.decorator';
import { AccountDeletionService } from './account-deletion.service';
import { OTP_LENGTH } from '../otp/user-otp.constants';

export class OtpDto {
  /**
   * Shape-validated here so a malformed body is refused before it reaches the
   * verifier and burns one of the account's five attempts.
   */
  @IsString()
  @Length(OTP_LENGTH, OTP_LENGTH, {
    message: `Enter the ${OTP_LENGTH}-digit code from your email.`,
  })
  @Matches(/^\d+$/, {
    message: `Enter the ${OTP_LENGTH}-digit code from your email.`,
  })
  otp!: string;
}

/**
 * The account-deletion lifecycle surface.
 *
 * Both state changes are two-step: request a code, then confirm with it. There
 * is deliberately NO route that schedules or cancels a deletion without a code
 * — the previous single-call endpoints were removed rather than kept alongside
 * these, because leaving them in place would have made the OTP step optional
 * for anyone willing to call the API directly, which is precisely the person it
 * exists to stop.
 *
 * `status`, both recovery routes and nothing else carry
 * `@AllowPendingDeletion()`: they are the only authenticated routes an account
 * inside its window may reach, which is what makes the recovery screen usable
 * while everything else stays refused by `JwtGuard`.
 */
@UseGuards(JwtGuard)
@Controller('api/account')
export class AccountDeletionController {
  constructor(private readonly deletion: AccountDeletionService) {}

  /**
   * What the full-screen gate renders: the exact scheduled instant, whether
   * recovery is still possible, and the address the account is tied to. Served
   * from the server so it cannot be faked by editing local state, and so a
   * device with a wrong clock still shows the right deadline.
   */
  @AllowPendingDeletion()
  @Get('deletion-status')
  async getDeletionStatus(@Req() req: AuthenticatedRequest) {
    return this.deletion.getStatus(req.user.id);
  }

  // ── Deletion ─────────────────────────────────────────────────────────────

  /** Step 1. Emails a code. Nothing is scheduled yet. */
  @Post('delete/request-otp')
  async requestDeletionOtp(@Req() req: AuthenticatedRequest) {
    return this.deletion.requestDeletionOtp(req.user.id, {
      ip: clientIp(req),
    });
  }

  /** Step 2. Verifies the code, then enters the 30-day window. */
  @Post('delete/confirm')
  async confirmDeletion(@Req() req: AuthenticatedRequest, @Body() dto: OtpDto) {
    return this.deletion.confirmDeletion(req.user.id, dto.otp, {
      ip: clientIp(req),
    });
  }

  // ── Recovery ─────────────────────────────────────────────────────────────

  /** Step 1. Emails a code. The deletion stays scheduled until step 2. */
  @AllowPendingDeletion()
  @Post('recover/request-otp')
  async requestRecoveryOtp(@Req() req: AuthenticatedRequest) {
    return this.deletion.requestRecoveryOtp(req.user.id, {
      ip: clientIp(req),
    });
  }

  /** Step 2. Verifies the code, then cancels the deletion. */
  @AllowPendingDeletion()
  @Post('recover/confirm')
  async confirmRecovery(@Req() req: AuthenticatedRequest, @Body() dto: OtpDto) {
    return this.deletion.confirmRecovery(req.user.id, dto.otp, {
      ip: clientIp(req),
    });
  }
}

/** First hop of `x-forwarded-for`, else the socket address. */
function clientIp(req: AuthenticatedRequest): string {
  return (
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.ip ||
    'unknown'
  );
}
