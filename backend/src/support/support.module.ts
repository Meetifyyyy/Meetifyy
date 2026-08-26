import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { EmailModule } from '../email/email.module';
import { RedisModule } from '../redis/redis.module';
import { UploadsModule } from '../uploads/uploads.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { JwtGuard } from '../common/guards/jwt.guard';
import { OptionalJwtGuard } from '../common/guards/optional-jwt.guard';
import { SupportRateLimitGuard } from '../common/guards/support-ratelimit.guard';
import { HelpService } from './help.service';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

/**
 * The public half of the support feature: the help centre the page reads and
 * the endpoint the request form posts to.
 *
 * The admin half lives in `admin/support` and `admin/help`, behind
 * AdminJwtGuard. They share the database models and the email templates but
 * not a controller - keeping the unauthenticated surface in its own module is
 * what makes it reviewable at a glance that nothing here can read a ticket.
 */
@Module({
  imports: [
    PrismaModule,
    EmailModule,
    RedisModule,
    UploadsModule,
    SupabaseModule,
  ],
  controllers: [SupportController],
  providers: [
    SupportService,
    HelpService,
    SupportRateLimitGuard,
    JwtGuard,
    OptionalJwtGuard,
  ],
  exports: [SupportService, HelpService],
})
export class SupportModule {}
