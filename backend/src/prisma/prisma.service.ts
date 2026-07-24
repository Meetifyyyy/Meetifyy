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
  }

  async onModuleInit() {
    // @ts-ignore
    this.$on('query', (e: any) => {
      if (e.duration >= 500) {
        this.logger.warn(`Slow Query (${e.duration}ms) - ${e.query}`);
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
