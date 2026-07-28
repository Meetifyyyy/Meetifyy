import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { RateLimitGuard } from './common/guards/ratelimit.guard';
import { NoCacheInterceptor } from './common/interceptors/no-cache.interceptor';
import { appConfig, supabaseConfig, redisConfig, r2Config, resendConfig } from './common/config/configuration';
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
import { UsersModule } from './users/users.module';
import { KeysModule } from './keys/keys.module';
import { MessagesModule } from './messages/messages.module';
import { MessagingCoreModule } from './messages/core/messaging-core.module';
import { DmModule } from './messages/dm/dm.module';
import { GroupChatsModule } from './messages/group-chats/group-chats.module';

import { SearchModule } from './search/search.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PresenceModule } from './presence/presence.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { EmailModule } from './email/email.module';
import { InstantMatchModule } from './instant-match/instant-match.module';
import { UploadsModule } from './uploads/uploads.module';
import { ModerationModule } from './moderation/moderation.module';
import { AdminModule } from './admin/admin.module';
import { RedisModule } from './redis/redis.module';
import { EventsModule } from './events/events.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, supabaseConfig, redisConfig, r2Config, resendConfig],
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
        transport: process.env.NODE_ENV !== 'production'
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
    SupabaseModule,
    PrismaModule,
    LinkPreviewModule,
    HealthModule,
    AuthModule,
    PostsModule,
    RealtimeModule,
    CommunitiesModule,
    ActivitiesModule,
    UsersModule,
    KeysModule,
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
      useFactory: async (configService: ConfigService) => {
        let connection: any = {};
        const redisUrlString = configService.get<string>('REDIS_URL');

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
            host: configService.get<string>('REDIS_HOST') || 'localhost',
            port: configService.get<number>('REDIS_PORT') || 6379,
            password: configService.get<string>('REDIS_PASSWORD'),
            tls: configService.get<string>('REDIS_TLS') === 'true' ? { rejectUnauthorized: false } : undefined,
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
            skipVersionCheck: true,
          };
        }

        return {
          connection,
          defaultJobOptions: {
            removeOnComplete: true,
            removeOnFail: { count: 100 },
          },
        };
      },
      inject: [ConfigService],
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
