import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { PushController } from './push.controller';
import { PushDevicesService } from './push-devices.service';
import { PushDispatcherService } from './push-dispatcher.service';
import { PushAudienceService } from './push-audience.service';
import { PushProcessor } from './push.processor';
import { WebPushProvider } from './providers/web-push.provider';
import { FcmProvider } from './providers/fcm.provider';
import { PUSH_QUEUE } from './push.types';

/**
 * Push notifications. Depends on nothing but Prisma, Redis and its queue, so
 * NotificationsModule, CommunitiesModule and the realtime gateway can import
 * it without a cycle. See docs/push-notifications.md.
 */
@Module({
  imports: [
    PrismaModule,
    RedisModule,
    BullModule.registerQueue({ name: PUSH_QUEUE }),
  ],
  controllers: [PushController],
  providers: [
    PushDevicesService,
    PushDispatcherService,
    PushAudienceService,
    PushProcessor,
    WebPushProvider,
    FcmProvider,
  ],
  exports: [PushDispatcherService],
})
export class PushModule {}
