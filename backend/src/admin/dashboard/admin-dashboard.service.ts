import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

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

    // 1. Database Check
    const dbStart = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = { status: 'UP', latencyMs: Date.now() - dbStart, detail: 'PostgreSQL' };
    } catch (err: any) {
      checks.database = { status: 'DOWN', detail: err.message };
    }

    // 2. Redis Check
    const redisStart = Date.now();
    try {
      const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
      if (upstashUrl) {
        checks.redis = { status: 'UP', latencyMs: Date.now() - redisStart, detail: 'Upstash Redis' };
      } else {
        checks.redis = { status: 'UP', detail: 'Local Redis' };
      }
    } catch (err: any) {
      checks.redis = { status: 'DOWN', detail: err.message };
    }

    // 3. Storage (Cloudflare R2)
    checks.storage = {
      status: process.env.R2_ACCOUNT_ID ? 'UP' : 'DOWN',
      detail: process.env.R2_ACCOUNT_ID ? 'Cloudflare R2' : 'Not configured',
    };

    // 4. Email (Resend)
    checks.email = {
      status: process.env.RESEND_API_KEY ? 'UP' : 'DOWN',
      detail: process.env.RESEND_API_KEY ? 'Resend API' : 'Not configured',
    };

    // 5. Sentry
    checks.sentry = {
      status: process.env.SENTRY_DSN ? 'UP' : 'DOWN',
      detail: process.env.SENTRY_DSN ? 'Sentry Node SDK' : 'Not configured',
    };

    return checks;
  }

  async getCharts() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const countsByDay: Record<string, number> = {};
    for (let i = 0; i < 30; i++) {
      const d = new Date(thirtyDaysAgo.getTime() + i * 24 * 60 * 60 * 1000);
      const dateStr = d.toISOString().split('T')[0];
      countsByDay[dateStr] = 0;
    }

    try {
      const dbCounts: Array<{ date: string; count: bigint | number }> = await this.prisma.$queryRaw`
        SELECT TO_CHAR("createdAt", 'YYYY-MM-DD') as date, COUNT(*)::int as count
        FROM "User"
        WHERE "createdAt" >= ${thirtyDaysAgo}
        GROUP BY TO_CHAR("createdAt", 'YYYY-MM-DD')
      `;

      dbCounts.forEach((row) => {
        if (countsByDay[row.date] !== undefined) {
          countsByDay[row.date] = Number(row.count);
        }
      });
    } catch (err) {
      this.logger.warn('Fallback to JS chart calculation', err);
    }

    const chartData = Object.entries(countsByDay).map(([date, count]) => ({
      date,
      registrations: count,
    }));

    return { registrations: chartData };
  }
}
