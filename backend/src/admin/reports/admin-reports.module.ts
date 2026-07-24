import { Module } from '@nestjs/common';
import { AdminReportsController } from './admin-reports.controller';
import { ModerationModule } from '../../moderation/moderation.module';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule, ModerationModule],
  controllers: [AdminReportsController],
})
export class AdminReportsModule {}
