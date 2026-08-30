import { Global, Module } from '@nestjs/common';
import { VerificationAccessService } from './verification-access.service';

@Global()
@Module({
  providers: [VerificationAccessService],
  exports: [VerificationAccessService],
})
export class VerificationAccessModule {}
