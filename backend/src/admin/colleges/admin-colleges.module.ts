import { Module } from '@nestjs/common';
import { AdminCollegesController } from './admin-colleges.controller';
import { AdminCollegesService } from './admin-colleges.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AdminCollegesController],
  providers: [AdminCollegesService],
  exports: [AdminCollegesService],
})
export class AdminCollegesModule {}
