import { Module } from '@nestjs/common';
import { AdminSupportController } from './admin-support.controller';
import { AdminSupportService } from './admin-support.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { EmailModule } from '../../email/email.module';

@Module({
  // EmailModule supplies the queue that carries admin replies to users.
  imports: [PrismaModule, EmailModule],
  controllers: [AdminSupportController],
  providers: [AdminSupportService],
  exports: [AdminSupportService],
})
export class AdminSupportModule {}
