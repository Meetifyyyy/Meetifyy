import { Module } from '@nestjs/common';
import { AdminFlagsController } from './admin-flags.controller';
import { AdminFlagsService } from './admin-flags.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AdminFlagsController],
  providers: [AdminFlagsService],
  exports: [AdminFlagsService],
})
export class AdminFlagsModule {}
