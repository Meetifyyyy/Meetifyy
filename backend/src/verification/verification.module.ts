import { Module } from '@nestjs/common';
import { VerificationService } from './verification.service';
import { VerificationUploadCollectorService } from './verification-upload-collector.service';
import { VerificationController } from './verification.controller';

@Module({
  controllers: [VerificationController],
  providers: [VerificationService, VerificationUploadCollectorService],
  exports: [VerificationService, VerificationUploadCollectorService],
})
export class VerificationModule {}
