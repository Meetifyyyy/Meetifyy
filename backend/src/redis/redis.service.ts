import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;

  constructor(private readonly configService: ConfigService) {
    const redisUrl = this.configService.get<string>('REDIS_URL');
    
    if (redisUrl) {
      try {
        const url = new URL(redisUrl);
        const isTls = url.protocol === 'rediss:';
        
        this.client = new Redis(redisUrl, {
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
          tls: isTls ? { rejectUnauthorized: false } : undefined,
        });
        
        this.client.on('connect', () => {
          this.logger.log('Shared Redis connection established');
        });
        
        this.client.on('error', (err) => {
          this.logger.error('Shared Redis connection error', err);
        });
      } catch (e) {
        this.logger.error('Failed to parse REDIS_URL', e);
      }
    } else {
      this.logger.warn('REDIS_URL not configured. RedisService will not be available.');
    }
  }

  getClient(): Redis | null {
    return this.client;
  }

  onModuleDestroy() {
    if (this.client) {
      this.client.disconnect();
    }
  }
}
