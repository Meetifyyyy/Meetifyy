import { Module, Global } from '@nestjs/common';
import { PresenceService } from './presence.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';

@Global()
@Module({
  imports: [PrismaModule, RedisModule],
  providers: [PresenceService],
  exports: [PresenceService],
})
export class PresenceModule {}
