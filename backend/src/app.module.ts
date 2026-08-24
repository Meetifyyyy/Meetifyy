import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { RateLimitGuard } from './common/guards/ratelimit.guard';
import { NoCacheInterceptor } from './common/interceptors/no-cache.interceptor';
import { config, configNamespaces } from './config';
import { SupabaseModule } from './supabase/supabase.module';
import { PrismaModule } from './prisma/prisma.module';
import { LinkPreviewModule } from './link-preview/link-preview.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { PostsModule } from './posts/posts.module';
import { RealtimeModule } from './realtime/realtime.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CommunitiesModule } from './communities/communities.module';
import { ActivitiesModule } from './activities/activities.module';
import { CampusEventsModule } from './campus-events/campus-events.module';
import { UsersModule } from './users/users.module';
import { MessagesModule } from './messages/messages.module';
import { MessagingCoreModule } from './messages/core/messaging-core.module';
import { DmModule } from './messages/dm/dm.module';
import { GroupChatsModule } from './messages/group-chats/group-chats.module';

import { SearchModule } from './search/search.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PresenceModule } from './presence/presence.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { BullModule } from '@nestjs/bullmq';
import Redis from 'ioredis';
import { EmailModule } from './email/email.module';
import { InstantMatchModule } from './instant-match/instant-match.module';
import { UploadsModule } from './uploads/uploads.module';
import { ModerationModule } from './moderation/moderation.module';
import { AdminModule } from './admin/admin.module';
import { RedisModule } from './redis/redis.module';
import { EventsModule } from './events/events.module';
import { DomainValidatorModule } from './common/services/domain-validator.module';
import { AcademicsModule } from './academics/academics.module';

@Module({
  imports: [
    DomainValidatorModule,
    ConfigModule.forRoot({
      isGlobal: true,
      // The namespaces are views onto the central `config` object, which has
      // already loaded and validated the environment by this point.
      load: configNamespaces,
      // dotenv loading is handled in src/config/env.ts so that configuration is
      // available to module-level code, not only to injected ConfigService.
      ignoreEnvFile: true,
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        genReqId: (req) => {
          return req.headers['x-request-id'] || require('crypto').randomUUID();
        },
        customSuccessMessage: (req, res, time) => {
          if (time > 1000) {
            req.log.warn(`[WARN] Slow Request ${req.method} ${req.url} ${time}ms`);
          }
          return `[HTTP] ${req.method} ${req.url} ${res.statusCode} ${time}ms req=${req.id}`;
        },
        customErrorMessage: (req, res, err) => {
          return `[HTTP] ${req.method} ${req.url} ${res.statusCode} req=${req.id} - ${err.message}`;
        },
        serializers: {
          req: (req) => {
            return {
              id: req.id,
              method: req.method,
              url: req.url,
              userId: req.raw?.user?.id,
            };
          },
          res: (res) => {
            return {
              statusCode: res.statusCode,
            };
          },
        },
        level: config.logging.level,
        transport: config.logging.pretty
          ? {
              target: 'pino-pretty',
              options: {
                singleLine: true,
                ignore: 'pid,hostname,req,res,responseTime',
                messageFormat: '{msg}',
              },
            }
          : undefined,
      },
    }),
    RedisModule,
    AcademicsModule,
    SupabaseModule,
    PrismaModule,
    LinkPreviewModule,
    HealthModule,
    AuthModule,
    PostsModule,
    RealtimeModule,
    CommunitiesModule,
    ActivitiesModule,
    CampusEventsModule,
    UsersModule,
    MessagesModule,
    MessagingCoreModule,
    DmModule,
    GroupChatsModule,

    SearchModule,
    NotificationsModule,
    PresenceModule,
    EventEmitterModule.forRoot(),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async () => {
        let connection: any = {};
        const redisUrlString = config.redis.url;

        if (redisUrlString) {
          const url = new URL(redisUrlString);
          connection = {
            host: url.hostname,
            port: parseInt(url.port, 10) || 6379,
            username: url.username || undefined,
            password: url.password || undefined,
            tls: url.protocol === 'rediss:' ? { rejectUnauthorized: false } : undefined,
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
            skipVersionCheck: true,
          };
        } else {
          connection = {
            host: config.redis.host,
            port: config.redis.port,
            password: config.redis.password,
            tls: config.redis.tls ? { rejectUnauthorized: false } : undefined,
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
            skipVersionCheck: true,
          };
        }

        let sharedProducerClient: Redis | null = null;
        let sharedSubscriberClient: Redis | null = null;

        return {
          connection,
          createClient: (type: 'client' | 'subscriber' | 'bclient', opts?: any) => {
            const clientOpts = {
              ...connection,
              ...(opts || {}),
              retryStrategy(times: number) {
                if (times > 5) return null;
                return Math.min(times * 1000, 5000);
              },
              reconnectOnError(err: Error) {
                if (err.message && err.message.includes('max number of clients reached')) {
                  return false;
                }
                return true;
              },
            };

            if (type === 'client') {
              if (!sharedProducerClient) {
                sharedProducerClient = new Redis(clientOpts as any);
              }
              return sharedProducerClient;
            }
            if (type === 'subscriber') {
              if (!sharedSubscriberClient) {
                sharedSubscriberClient = new Redis(clientOpts as any);
              }
              return sharedSubscriberClient;
            }
            return new Redis(clientOpts as any);
          },
          defaultJobOptions: {
            removeOnComplete: true,
            removeOnFail: { count: 100 },
          },
        };
      },
    }),
    EmailModule,
    InstantMatchModule,
    UploadsModule,
    ModerationModule,
    AdminModule,
    EventsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: RateLimitGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: NoCacheInterceptor,
    },
  ],
})
export class AppModule {}
