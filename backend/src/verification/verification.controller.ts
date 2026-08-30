import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import { VerificationService } from './verification.service';
import { JwtGuard } from '../common/guards';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('verification')
@UseGuards(JwtGuard)
export class VerificationController {
  constructor(private readonly verificationService: VerificationService) {}

  @Post('request')
  async submitVerification(
    @CurrentUser('id') userId: string,
    @Body() body: { selfieMediaId: string; idCardMediaId: string },
  ) {
    return this.verificationService.submitVerification(userId, body.selfieMediaId, body.idCardMediaId);
  }

  @Get('status')
  async getStatus(@CurrentUser('id') userId: string) {
    return this.verificationService.getStatus(userId);
  }
}
