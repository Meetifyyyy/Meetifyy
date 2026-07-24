import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AdminAuthModule } from './auth/admin-auth.module';
import { AdminCollegesModule } from './colleges/admin-colleges.module';
import { AdminUsersModule } from './users/admin-users.module';
import { AdminReportsModule } from './reports/admin-reports.module';
import { AdminDashboardModule } from './dashboard/admin-dashboard.module';
import { AdminSupportModule } from './support/admin-support.module';
import { AdminFlagsModule } from './flags/admin-flags.module';
import { AdminSettingsModule } from './settings/admin-settings.module';
import { AdminAuditModule } from './audit/admin-audit.module';
import { AuditInterceptor } from './common/audit.interceptor';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [
    PrismaModule,
    AdminAuthModule,
    AdminCollegesModule,
    AdminUsersModule,
    AdminReportsModule,
    AdminDashboardModule,
    AdminSupportModule,
    AdminFlagsModule,
    AdminSettingsModule,
    AdminAuditModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AdminModule {}
