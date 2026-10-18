import { Module } from '@nestjs/common';
import { AdminLegalController } from './admin-legal.controller';
import { AdminLegalService } from './admin-legal.service';

/**
 * Terms, Privacy, Cookies and Community Guidelines: draft → preview → publish
 * (optionally notifying users). The public read side is LegalModule;
 * LegalConsentService (global) owns the caches both sides share.
 */
@Module({
  controllers: [AdminLegalController],
  providers: [AdminLegalService],
})
export class AdminLegalModule {}
