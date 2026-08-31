import { Module } from '@nestjs/common';

import { SuspensionController } from './suspension.controller';
import { SuspensionService } from './suspension.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SupabaseModule } from '../supabase/supabase.module';

/**
 * The suspension screen and its appeal flow.
 *
 * Kept out of SupportModule even though an appeal is stored as a support
 * ticket: this is the only module a suspended account may reach, and keeping
 * that surface small and obvious is the point.
 */
@Module({
  imports: [PrismaModule, SupabaseModule],
  controllers: [SuspensionController],
  providers: [SuspensionService],
})
export class SuspensionModule {}
