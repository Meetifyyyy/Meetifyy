import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import { VerificationService } from './verification.service';
import { JwtGuard } from '../common/guards';
import { CurrentUser } from '../common/decorators/current-user.decorator';

// `api/verification`, not `verification`. Every other user-facing controller in
// the app is mounted under `api/`, the client has always posted to
// `/api/verification/request`, and there is no global prefix — so this handler
// was mounted at a path nothing called. Submitting verification 404'd, which is
// why no account could progress past UNVERIFIED through the UI at all.
@Controller('api/verification')
@UseGuards(JwtGuard)
export class VerificationController {
  constructor(private readonly verificationService: VerificationService) {}

  @Post('request')
  async submitVerification(
    @CurrentUser('id') userId: string,
    @Body() body: { selfieMediaId: string; idCardMediaId: string },
  ) {
    return this.verificationService.submitVerification(
      userId,
      body.selfieMediaId,
      body.idCardMediaId,
    );
  }

  @Get('status')
  async getStatus(@CurrentUser('id') userId: string) {
    return this.verificationService.getStatus(userId);
  }
}
