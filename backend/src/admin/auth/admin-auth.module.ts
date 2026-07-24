import { Module } from '@nestjs/common';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { EmailModule } from '../../email/email.module';

@Module({
  imports: [PrismaModule, EmailModule],
  controllers: [AdminAuthController],
  providers: [AdminAuthService],
  exports: [AdminAuthService],
})
export class AdminAuthModule {}
