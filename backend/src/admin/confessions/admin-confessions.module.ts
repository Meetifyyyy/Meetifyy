import { Module } from '@nestjs/common';
import { AdminConfessionsController } from './admin-confessions.controller';
import { ConfessionsModule } from '../../confessions/confessions.module';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule, ConfessionsModule],
  controllers: [AdminConfessionsController],
})
export class AdminConfessionsModule {}
