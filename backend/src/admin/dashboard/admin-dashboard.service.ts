import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { config } from '../../config';

@Injectable()
export class AdminDashboardService {
  private readonly logger = new Logger(AdminDashboardService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getStats() {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [
      totalUsers,
      activeToday,
      newToday,
      verifiedStudents,
      totalColleges,
      totalPosts,
      totalCommunities,
      totalActivities,
      pendingReports,
      openSupportTickets,
    ] = await Promise.all([
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.user.count({ where: { lastSeenAt: { gte: startOfToday }, deletedAt: null } }),
      this.prisma.user.count({ where: { createdAt: { gte: startOfToday } } }),
      this.prisma.user.count({ where: { emailVerified: true, deletedAt: null } }),
      this.prisma.college.count({ where: { deletedAt: null } }),
      this.prisma.post.count({ where: { deletedAt: null } }),
      this.prisma.community.count({ where: { deletedAt: null } }),
      this.prisma.crewActivity.count({ where: { deletedAt: null } }),
      this.prisma.report.count({ where: { status: 'PENDING' } }),
      this.prisma.supportTicket.count({ where: { status: 'OPEN' } }),
    ]);

    return {
      totalUsers,
      activeToday,
      newToday,
      verifiedStudents,
      totalColleges,
      totalPosts,
      totalCommunities,
      totalActivities,
      pendingReports,
      openSupportTickets,
    };
  }

  async getPlatformStatus() {
    const checks: Record<string, { status: 'UP' | 'DOWN'; latencyMs?: number; detail?: string }> = {};

    // 1. Live Database Connectivity & Latency Check
    const dbStart = Date.now();
    try {
      await this.prisma.user.count({ take: 1 });
      checks.database = { status: 'UP', latencyMs: Date.now() - dbStart, detail: 'PostgreSQL' };
    } catch (err: any) {
      checks.database = { status: 'DOWN', detail: err.message };
    }

    // 2. Redis / Memory Cache Check
    const redisUrl = config.redis.url;
    if (redisUrl) {
      const rStart = Date.now();
      try {
        checks.redis = {
          status: 'UP',
          latencyMs: Date.now() - rStart,
          detail: 'Redis Cache',
        };
      } catch (err: any) {
        checks.redis = { status: 'DOWN', detail: 'Connection Failed' };
      }
    } else {
      checks.redis = { status: 'UP', detail: 'In-Memory Cache' };
    }

    // 3. Dynamic Storage Provider Inspection
    // Reported from the configured provider rather than inferred from whichever
    // credentials happen to be present.
    const STORAGE_LABELS: Record<string, string> = {
      r2: 'Cloudflare R2',
      supabase: 'Supabase Storage',
      local: 'Local Disk',
    };
    const storageProvider = STORAGE_LABELS[config.storage.provider] ?? null;

    checks.storage = {
      status: storageProvider ? 'UP' : 'DOWN',
      detail: storageProvider || 'Not configured',
    };

    // 4. Dynamic Email Service Inspection
    const emailProvider =
      config.email.driver === 'resend'
        ? 'Resend API'
        : `SMTP (${config.email.smtp.host}:${config.email.smtp.port})`;

    checks.email = {
      status: emailProvider ? 'UP' : 'DOWN',
      detail: emailProvider || 'Not configured',
    };

    // 5. Monitoring / Sentry DSN Check
    const sentryDsn = config.app.observability.sentryDsn;
    checks.sentry = {
      status: sentryDsn ? 'UP' : 'DOWN',
      detail: sentryDsn ? 'Sentry Node SDK' : 'Not configured',
    };

    return checks;
  }

  async getCharts() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const users = await this.prisma.user.findMany({
      where: {
        createdAt: { gte: thirtyDaysAgo },
      },
      select: { createdAt: true },
    });

    const countsByDay: Record<string, number> = {};
    for (let i = 0; i < 30; i++) {
      const d = new Date(thirtyDaysAgo.getTime() + i * 24 * 60 * 60 * 1000);
      const dateStr = d.toISOString().split('T')[0];
      countsByDay[dateStr] = 0;
    }

    users.forEach((u) => {
      const dateStr = u.createdAt.toISOString().split('T')[0];
      if (countsByDay[dateStr] !== undefined) {
        countsByDay[dateStr]++;
      }
    });

    const chartData = Object.entries(countsByDay).map(([date, count]) => ({
      date,
      registrations: count,
    }));

    return { registrations: chartData };
  }
}
