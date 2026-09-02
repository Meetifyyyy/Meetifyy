import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { config } from '../../config';
import { RedisService } from '../../redis/redis.service';

@Injectable()
export class AdminDashboardService {
  private readonly logger = new Logger(AdminDashboardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  async getStats() {
    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );

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
      this.prisma.user.count({
        where: { lastSeenAt: { gte: startOfToday }, deletedAt: null },
      }),
      this.prisma.user.count({
        where: { createdAt: { gte: startOfToday }, deletedAt: null },
      }),
      this.prisma.user.count({
        where: { verificationStatus: 'VERIFIED', deletedAt: null },
      }),
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
    const checks: Record<
      string,
      { status: 'UP' | 'DOWN'; latencyMs?: number; detail?: string }
    > = {};

    // 1. Live Database Connectivity & Latency Check
    const dbStart = Date.now();
    try {
      // `SELECT 1`, not `user.count()`. A liveness probe should measure the
      // round trip, and counting a table measures the table: as the user count
      // grows this reports rising "database latency" that is really just a
      // sequential scan the health check asked for.
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = {
        status: 'UP',
        latencyMs: Date.now() - dbStart,
        detail: 'PostgreSQL',
      };
    } catch (err: any) {
      checks.database = { status: 'DOWN', detail: err.message };
    }

    // 2. Redis: a real round trip.
    //
    // This block used to open the try, immediately assign UP, and close it. No
    // Redis call was ever made, so the catch was unreachable and the "latency"
    // was the cost of two Date.now() calls - which is why the dashboard read a
    // permanent 0ms. A Redis that was configured but unreachable reported UP,
    // which is the one situation a health check exists to catch.
    //
    // The analytics page already learned this lesson (see probeRedis in
    // admin-analytics.service.ts); this panel had kept the old version.
    const client = this.redisService.getClient();
    if (!client) {
      checks.redis = {
        status: config.redis.url ? 'DOWN' : 'UP',
        detail: config.redis.url
          ? 'REDIS_URL is set but no client is connected'
          : 'In-Memory Cache',
      };
    } else {
      const rStart = Date.now();
      try {
        await client.ping();
        checks.redis = {
          status: 'UP',
          latencyMs: Date.now() - rStart,
          detail: 'Redis Cache',
        };
      } catch (err: any) {
        checks.redis = {
          status: 'DOWN',
          detail: err?.message || 'Connection failed',
        };
      }
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

  /** Local calendar day for a timestamp, as YYYY-MM-DD. */
  private static localDayKey(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /**
   * Registrations per day for the last 30 days, ending TODAY.
   *
   * Two bugs made this read as a flat zero line on a platform that had users.
   *
   * The window excluded today. It built 30 buckets starting from
   * `now - 30 days` and stepping forward 29 times, so the last bucket was
   * YESTERDAY, and any account created today fell outside the map and was
   * dropped by the `!== undefined` guard rather than counted. On a young
   * platform where most sign-ups are recent that is most of the data, and it is
   * exactly what the dashboard showed: 37 users, 37 new registrations, and a
   * chart flat on zero.
   *
   * The buckets were also keyed by UTC date while `getStats` counts "today"
   * from LOCAL midnight, so the two disagreed about which day a registration
   * belonged to for the whole UTC offset. In IST that is every sign-up between
   * 05:30 and midnight, moved to the wrong bar.
   *
   * Both now derive from the same local-midnight boundary that getStats uses.
   */
  async getCharts() {
    const DAYS = 30;
    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    // Inclusive of today, so the window is [today-29 .. today].
    const windowStart = new Date(startOfToday);
    windowStart.setDate(windowStart.getDate() - (DAYS - 1));

    const users = await this.prisma.user.findMany({
      where: { createdAt: { gte: windowStart }, deletedAt: null },
      select: { createdAt: true },
    });

    const countsByDay = new Map<string, number>();
    for (let i = 0; i < DAYS; i++) {
      const d = new Date(windowStart);
      d.setDate(d.getDate() + i);
      countsByDay.set(AdminDashboardService.localDayKey(d), 0);
    }

    for (const u of users) {
      const key = AdminDashboardService.localDayKey(u.createdAt);
      const current = countsByDay.get(key);
      if (current !== undefined) countsByDay.set(key, current + 1);
    }

    return {
      registrations: Array.from(countsByDay, ([date, registrations]) => ({
        date,
        registrations,
      })),
    };
  }
}
