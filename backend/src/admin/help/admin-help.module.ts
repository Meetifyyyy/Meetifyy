import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { AdminHelpController } from './admin-help.controller';
import { AdminHelpService } from './admin-help.service';

/**
 * Help-content management for the Admin Dashboard's Support section. Routes
 * live under `/admin/support/help` - see AdminHelpController for why.
 */
@Module({
  imports: [PrismaModule],
  controllers: [AdminHelpController],
  providers: [AdminHelpService],
  exports: [AdminHelpService],
})
export class AdminHelpModule {}
