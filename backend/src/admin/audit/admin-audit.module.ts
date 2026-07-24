import { Module } from '@nestjs/common';
import { AdminAuditController } from './admin-audit.controller';
import { AdminAuditService } from './admin-audit.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AdminAuditController],
  providers: [AdminAuditService],
  exports: [AdminAuditService],
})
export class AdminAuditModule {}
