import { Module } from '@nestjs/common';
import { AdminVerificationController } from './admin-verification.controller';
import { AdminVerificationService } from './admin-verification.service';

@Module({
  controllers: [AdminVerificationController],
  providers: [AdminVerificationService],
})
export class AdminVerificationModule {}
