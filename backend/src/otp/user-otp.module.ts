import { Module } from '@nestjs/common';
import { UserOtpService } from './user-otp.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';

/**
 * One-time codes for the account-deletion lifecycle.
 *
 * Its own module so the deletion and recovery flows share one implementation of
 * the security-critical parts — generation, keyed hashing, constant-time
 * comparison, single-use consumption, attempt and rate limits — rather than
 * each growing its own subtly different copy.
 */
@Module({
  imports: [PrismaModule, RedisModule],
  providers: [UserOtpService],
  exports: [UserOtpService],
})
export class UserOtpModule {}
