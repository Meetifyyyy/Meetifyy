import { Module } from '@nestjs/common';
import { AdminLegalController } from './admin-legal.controller';
import { AdminLegalService } from './admin-legal.service';

@Module({
  controllers: [AdminLegalController],
  providers: [AdminLegalService],
})
export class AdminLegalModule {}
