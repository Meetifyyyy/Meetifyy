import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AdminAuthModule } from './auth/admin-auth.module';
import { AdminCollegesModule } from './colleges/admin-colleges.module';
import { AdminUsersModule } from './users/admin-users.module';
import { AdminVerificationModule } from './verification/admin-verification.module';
import { AdminReportsModule } from './reports/admin-reports.module';
import { AdminDashboardModule } from './dashboard/admin-dashboard.module';
import { AdminSupportModule } from './support/admin-support.module';
import { AdminHelpModule } from './help/admin-help.module';
import { AdminAnalyticsModule } from './analytics/admin-analytics.module';
import { AdminAuditModule } from './audit/admin-audit.module';
import { AdminAccountDeletionModule } from './account-deletion/admin-account-deletion.module';
import { AuditInterceptor } from './common/audit.interceptor';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [
    PrismaModule,
    AdminAuthModule,
    AdminCollegesModule,
    AdminUsersModule,
    AdminVerificationModule,
    AdminReportsModule,
    AdminDashboardModule,
    AdminSupportModule,
    // Public help-centre content, managed from the same Support section.
    AdminHelpModule,
    AdminAuditModule,
    // Account-deletion requests and the 30-day retention deadline. Its own
    // section rather than a tab under Users: meeting a deletion deadline is a
    // different job from moderating an account.
    AdminAccountDeletionModule,
    // Infrastructure + resource usage, measured live.
    AdminAnalyticsModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AdminModule {}
