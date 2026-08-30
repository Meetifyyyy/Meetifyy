import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import {
  httpLine,
  fromRequest,
  LOG_CAUSE,
  prettyFormatters,
  PRETTY_IGNORE,
  PRETTY_MESSAGE_FORMAT,
} from './common/logging/log-format';
import { RateLimitGuard } from './common/guards/ratelimit.guard';
import { VerificationGuard } from './common/guards/verification.guard';
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
import { VerificationModule } from './verification/verification.module';
import { RedisModule } from './redis/redis.module';
import { EventsModule } from './events/events.module';
import { DomainValidatorModule } from './common/services/domain-validator.module';
import { AcademicsModule } from './academics/academics.module';
import { SupportModule } from './support/support.module';
import { MonitoringModule } from './monitoring/monitoring.module';

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
            req.log.warn(
              httpLine({
                method: req.method,
                url: req.url,
                status: res.statusCode,
                ms: time,
                userId: fromRequest(req, (r) => r?.user?.id),
                reqId: req.id as string,
                cause: 'slow request',
              }),
            );
          }
          return httpLine({
            method: req.method,
            url: req.url,
            status: res.statusCode,
            ms: time,
            // The user was missing from the success line entirely, so a normal
            // request could not be attributed to anyone without cross-checking
            // the request id against some other line that happened to carry it.
            userId: fromRequest(req, (r) => r?.user?.id),
            reqId: req.id as string,
            // HttpExceptionFilter stashes the reason a 4xx was refused here
            // rather than logging its own line. Both used to print: one with
            // the cause and no latency, one with the latency and no cause, for
            // every single rejected request.
            cause: fromRequest(req, (r) => r?.[LOG_CAUSE]),
          });
        },
        customErrorMessage: (req, res, err) =>
          httpLine({
            method: req.method,
            url: req.url,
            status: res.statusCode,
            userId: fromRequest(req, (r) => r?.user?.id),
            reqId: req.id as string,
            cause: err.message,
          }),
        customLogLevel: (req, res, err) => {
          // 5xx is owned by HttpExceptionFilter, which has the stack; this
          // line would be its third copy, so it is kept at debug for when the
          // extra timing detail is wanted. 4xx is owned here — the filter only
          // contributes the cause, via LOG_CAUSE above.
          if (res.statusCode >= 500 || err) return 'debug';
          if (res.statusCode >= 400) return 'warn';
          return 'info';
        },
        serializers: {
          // Never expand a stack here; the filter owns error reporting.
          err: (err) => ({ type: err.type, message: err.message }),
          req: (req) => ({
            id: req.id,
            method: req.method,
            url: req.url,
            userId: req.raw?.user?.id,
          }),
          res: (res) => ({ statusCode: res.statusCode }),
        },
        // Pretty output only: builds the aligned `time level [context]`
        // prefix in the main thread, since pino-pretty cannot align it itself
        // (see log-format.ts). Structured JSON logs are left untouched.
        ...(config.logging.pretty ? { formatters: prettyFormatters } : {}),
        level: config.logging.level,
        transport: config.logging.pretty
          ? {
              target: 'pino-pretty',
              options: {
                singleLine: true,
                // `time`, `level` and `context` are rebuilt into the message
                // by `prettyFormatters` so their widths are fixed; pino-pretty
                // must not also print its own variable-width versions.
                ignore: PRETTY_IGNORE,
                // Must stay a plain string. pino-pretty runs in a worker
                // thread, so anything in here is structured-cloned — a
                // function threw DataCloneError and killed the boot.
                messageFormat: PRETTY_MESSAGE_FORMAT,
                colorize: false,
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
            tls:
              url.protocol === 'rediss:'
                ? { rejectUnauthorized: false }
                : undefined,
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
          // Namespaces every queue by environment. Without it, a local worker
          // pointed at the deployed Redis silently steals production jobs.
          prefix: config.redis.queuePrefix,
          createClient: (
            type: 'client' | 'subscriber' | 'bclient',
            opts?: any,
          ) => {
            const clientOpts = {
              ...connection,
              ...(opts || {}),
              retryStrategy(times: number) {
                if (times > 5) return null;
                return Math.min(times * 1000, 5000);
              },
              reconnectOnError(err: Error) {
                if (
                  err.message &&
                  err.message.includes('max number of clients reached')
                ) {
                  return false;
                }
                return true;
              },
            };

            if (type === 'client') {
              if (!sharedProducerClient) {
                sharedProducerClient = new Redis(clientOpts);
              }
              return sharedProducerClient;
            }
            if (type === 'subscriber') {
              if (!sharedSubscriberClient) {
                sharedSubscriberClient = new Redis(clientOpts);
              }
              return sharedSubscriberClient;
            }
            return new Redis(clientOpts);
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
    VerificationModule,
    AdminModule,
    // Public help centre + support-request intake. The admin-facing half lives
    // inside AdminModule, behind AdminJwtGuard.
    SupportModule,
    // Application-level observability. Registers a global interceptor, so it
    // must be imported for any route to be instrumented.
    MonitoringModule,
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
      provide: APP_GUARD,
      useClass: VerificationGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: NoCacheInterceptor,
    },
  ],
})
export class AppModule {}
