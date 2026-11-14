import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { config } from '../../config';
import { RedisService } from '../../redis/redis.service';
import { stringField } from '../../common/utils/type-guards.util';
import { ShortLivedValue } from '../../common/utils/short-lived-value.util';

/** The dashboard's headline counts. */
export interface DashboardStats {
  totalUsers: number;
  activeToday: number;
  newToday: number;
  verifiedStudents: number;
  totalColleges: number;
  totalPosts: number;
  totalCommunities: number;
  totalActivities: number;
  pendingReports: number;
  openSupportTickets: number;
}

/** Registrations per local day, oldest first. */
export interface DashboardCharts {
  registrations: Array<{ date: string; registrations: number }>;
}

@Injectable()
export class AdminDashboardService {
  private readonly logger = new Logger(AdminDashboardService.name);

  /**
   * The counts are polled every 30 s by every open dashboard tab, and the chart
   * every 2 minutes (ADM-13, ADM-14). Kept for exactly those windows, so the
   * database does each once per window per replica whatever the number of
   * tabs; the numbers are no staler than a single tab already showed.
   */
  private readonly stats = new ShortLivedValue<DashboardStats>(30_000);
  private readonly charts = new ShortLivedValue<DashboardCharts>(120_000);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  getStats(): Promise<DashboardStats> {
    return this.stats.get(() => this.computeStats());
  }

  private async computeStats(): Promise<DashboardStats> {
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
    } catch (err: unknown) {
      checks.database = { status: 'DOWN', detail: stringField(err, 'message') };
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
      } catch (err: unknown) {
        checks.redis = {
          status: 'DOWN',
          detail: stringField(err, 'message') || 'Connection failed',
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
  getCharts(): Promise<DashboardCharts> {
    return this.charts.get(() => this.computeCharts());
  }

  private async computeCharts(): Promise<DashboardCharts> {
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

    // Counted per day in the database (ADM-14): this used to load every
    // registration of the last 30 days into Node to bucket them. The day is
    // the server's LOCAL calendar day, the same boundary getStats uses:
    // timestamps are stored in UTC, so each is read as UTC and converted to
    // this process's time zone before taking its date.
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const days = await this.prisma.$queryRaw<Array<{ day: string; n: number }>>`
      SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${zone}, 'YYYY-MM-DD') AS day,
             count(*)::int AS n
      FROM "User"
      WHERE "createdAt" >= ${windowStart} AND "deletedAt" IS NULL
      GROUP BY 1`;

    const countsByDay = new Map<string, number>();
    for (let i = 0; i < DAYS; i++) {
      const d = new Date(windowStart);
      d.setDate(d.getDate() + i);
      countsByDay.set(AdminDashboardService.localDayKey(d), 0);
    }

    for (const { day, n } of days) {
      if (countsByDay.has(day)) countsByDay.set(day, n);
    }

    return {
      registrations: Array.from(countsByDay, ([date, registrations]) => ({
        date,
        registrations,
      })),
    };
  }
}
