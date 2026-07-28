import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient<
  { log: [{ emit: 'event', level: 'query' }, { emit: 'stdout', level: 'error' }, { emit: 'stdout', level: 'warn' }] },
  'query'
> implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('DATABASE');

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'stdout', level: 'error' },
        { emit: 'stdout', level: 'warn' },
      ],
    });

    // Handle transient database connection drops with automatic retry
    this.$use(async (params, next) => {
      let retries = 2;
      while (retries >= 0) {
        try {
          return await next(params);
        } catch (error: any) {
          const isConnError =
            error?.code === 'P1001' ||
            error?.code === 'P1002' ||
            error?.code === 'P1008' ||
            error?.code === 'P1017' ||
            (error?.message && (
              error.message.includes("Can't reach database server") ||
              error.message.includes('Timed out fetching a new connection') ||
              error.message.includes('Connection pool timeout')
            ));

          if (isConnError && retries > 0) {
            retries--;
            this.logger.warn(`Database transient connection issue (${error.code || 'network'}). Retrying... (${retries} attempts remaining)`);
            await new Promise((res) => setTimeout(res, 300));
            continue;
          }
          throw error;
        }
      }
    });
  }

  async onModuleInit() {
    const isDev = process.env.NODE_ENV !== 'production';

    // @ts-ignore
    this.$on('query', (e: any) => {
      if (e.duration >= 500) {
        this.logger.warn(`Slow Query (${e.duration}ms) - ${e.query}`);
      } else if (isDev) {
        this.logger.debug(`Query (${e.duration}ms) - ${e.query}`);
      }
    });

    try {
      await this.$connect();
      // Warm up connection pool on boot to prevent first-query cold start delays
      await this.$queryRawUnsafe('SELECT 1').catch(() => {});
      this.logger.log('Connected and pool warmed up');
    } catch (error) {
      this.logger.error('Could not connect to database on startup.');
      this.logger.debug(error);
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
