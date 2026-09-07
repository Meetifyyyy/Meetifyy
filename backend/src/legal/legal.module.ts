import { Module } from '@nestjs/common';
import { LegalController } from './legal.controller';
import { LegalService } from './legal.service';

/**
 * The public half of the legal-document system. The admin half lives in
 * `AdminLegalModule`, behind `AdminJwtGuard` — the same split the help centre
 * uses, and for the same reason: there is one set of tables, and exactly one
 * module that may write to them.
 */
@Module({
  controllers: [LegalController],
  providers: [LegalService],
  exports: [LegalService],
})
export class LegalModule {}
