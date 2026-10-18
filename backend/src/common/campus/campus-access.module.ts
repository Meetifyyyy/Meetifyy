import { Global, Module } from '@nestjs/common';
import { CampusAccessService } from './campus-access.service';

/** Global, beside VerificationAccessModule: every campus surface consults it. */
@Global()
@Module({
  providers: [CampusAccessService],
  exports: [CampusAccessService],
})
export class CampusAccessModule {}
