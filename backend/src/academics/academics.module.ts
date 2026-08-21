import { Global, Module } from '@nestjs/common';
import { AcademicsService } from './academics.service';
import { AcademicsController } from './academics.controller';

/**
 * Global so auth, users and admin can all validate academic input against the
 * same catalogue without each module re-registering (or re-implementing) it.
 */
@Global()
@Module({
  controllers: [AcademicsController],
  providers: [AcademicsService],
  exports: [AcademicsService],
})
export class AcademicsModule {}
