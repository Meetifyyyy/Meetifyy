import { Module } from '@nestjs/common';
import { LegalController } from './legal.controller';
import { LegalService } from './legal.service';

/**
 * The public half of the legal-document system: published versions, their
 * history, and each user's consent record. The admin half (drafts, publish,
 * notify) is `AdminLegalModule`, behind `AdminJwtGuard`.
 */
@Module({
  controllers: [LegalController],
  providers: [LegalService],
  exports: [LegalService],
})
export class LegalModule {}
