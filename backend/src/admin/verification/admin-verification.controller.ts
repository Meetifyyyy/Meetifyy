import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  Query,
  Req,
} from '@nestjs/common';
import type { AdminRequest } from '../../common/types/authenticated-request';
import { AdminVerificationService } from './admin-verification.service';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import { VerificationStatus } from '@prisma/client';

/**
 * Verification review, on the same rails as the rest of the admin portal.
 *
 * This controller used to be the one exception in `admin/`: mounted at
 * `api/admin/verification` while every sibling is `admin/…` and the admin
 * client calls `admin/…` — so the review screen 404'd and no request was ever
 * decided through it. (The database agreed: zero verification requests, four
 * users flipped to VERIFIED by direct writes.)
 *
 * It also guarded with `JwtGuard + AdminGuard` — the *app's* user session —
 * rather than `AdminJwtGuard`. That was strictly weaker on the single most
 * sensitive admin action in the product:
 *
 *  - no CSRF check on a mutating request, which every other admin mutation has;
 *  - no admin-session liveness or revocation check, so a revoked session kept
 *    working until its JWT expired;
 *  - a shared `x-super-admin-api-key` header was accepted, authenticating the
 *    call as nobody in particular — unattributable by construction.
 *
 * And because the request carried a `User` rather than a `SuperAdmin`, neither
 * `VerificationRequest.reviewerId` nor an `AuditLog` row could be written: both
 * are foreign-keyed to `SuperAdmin`. Moving to the standard guard is what makes
 * a review attributable at all.
 */
@Controller('admin/verification')
@UseGuards(AdminJwtGuard)
export class AdminVerificationController {
  constructor(
    private readonly adminVerificationService: AdminVerificationService,
  ) {}

  @Get('requests')
  async listRequests(
    @Query('status') status?: VerificationStatus,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 20;
    const offsetNum = offset ? parseInt(offset, 10) : 0;
    return this.adminVerificationService.listRequests(
      status,
      limitNum,
      offsetNum,
    );
  }

  @Patch('requests/:id/status')
  async updateStatus(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body('status') status: VerificationStatus,
    @Body('adminNotes') adminNotes?: string,
  ) {
    // `req.admin` is set by AdminJwtGuard and is a real SuperAdmin row, which is
    // what `reviewerId` references. Taken from the verified session, never from
    // the request body.
    return this.adminVerificationService.updateStatus(
      id,
      status,
      adminNotes,
      req.admin?.id,
    );
  }
}
