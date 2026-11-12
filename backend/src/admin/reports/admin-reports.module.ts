import { Module } from '@nestjs/common';
import { AdminReportsController } from './admin-reports.controller';
import { ModerationModule } from '../../moderation/moderation.module';
import { AdminReportsService } from './admin-reports.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule, ModerationModule],
  controllers: [AdminReportsController],
  providers: [AdminReportsService],
})
export class AdminReportsModule {}
