import { Injectable, Logger } from '@nestjs/common';
import {
  HeadBucketCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';

import { config } from '../../config';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { EmailUsageService } from '../../email/email-usage.service';
import { SlowRequestRetentionService } from '../../observability/slow-request-retention.service';

/**
 * Infrastructure and resource usage, measured rather than asserted.
 *
 * Every number returned from here comes from a live call to the thing being
 * reported on — a query against the database, a `PING`/`INFO` against Redis, a
 * signed request to the bucket. Nothing is inferred from the presence of an
 * environment variable, and nothing is estimated on the client.
 *
 * A service this cannot reach is reported `DOWN` with the reason; a service
 * this has no credentials for is reported `NOT_CONFIGURED` and shows no
 * figures. Those two are deliberately distinct: "broken" and "not set up" call
 * for completely different responses, and collapsing them into one status is
 * how a dashboard starts lying.
 */

export type ServiceState = 'UP' | 'DOWN' | 'NOT_CONFIGURED';

export interface ServiceReport {
  /** Human label for the panel heading. */
  name: string;
  state: ServiceState;
  /** Round-trip of the probe that produced this report, when one ran. */
  latencyMs?: number;
  /** Why it is down, or what is missing to configure it. */
  detail?: string;
  /** Measured figures. Absent when the probe could not run. */
  metrics?: Array<{
    label: string;
    value: number | string;
    /** 'bytes' | 'count' | 'ms' | 'percent' | 'text' — how to format client-side. */
    unit: string;
    /** Present only where the provider actually publishes a ceiling. */
    limit?: number | null;
  }>;
}

/** Which surface a recorded request belongs to. */
export type SlowRequestSurface = 'all' | 'admin' | 'app';

/**
 * Splits recorded traffic by surface.
 *
 * Admin-portal routes and public app routes are reported separately because a
 * latency that is unremarkable on one is an incident on the other, and mixing
 * them buries the handful of student-facing regressions under routine admin
 * queries. Anything not under the admin prefix is public app traffic.
 */
function surfaceFilter(surface: SlowRequestSurface) {
  const prefix = config.analytics.adminRoutePrefix;
  if (surface === 'admin') return { route: { startsWith: prefix } };
  if (surface === 'app') return { NOT: { route: { startsWith: prefix } } };
  return {};
}

@Injectable()
export class AdminAnalyticsService {
  private readonly logger = new Logger(AdminAnalyticsService.name);
  private r2Client: S3Client | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly emailUsage: EmailUsageService,
    private readonly retention: SlowRequestRetentionService,
  ) {}

  /** Every service panel, probed concurrently so one slow provider can't stall the page. */
  async getInfrastructure(): Promise<{
    generatedAt: string;
    services: ServiceReport[];
    unconfigured: Array<{ name: string; requires: string[] }>;
  }> {
    const [database, redis, storage, emailReports] = await Promise.all([
      this.probeDatabase(),
      this.probeRedis(),
      this.probeR2(),
      this.probeEmail(),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      services: [database, redis, storage, ...emailReports],
      // Named explicitly so the page can say what is missing rather than
      // rendering an empty card the reader has to interpret.
      unconfigured: this.unconfiguredProviders(),
    };
  }

  /**
   * Providers the operator asked for that this deployment cannot report on.
   *
   * Listed rather than silently omitted, and never filled with placeholder
   * numbers: an unmeasured quantity has no value, not a default one.
   */
  private unconfiguredProviders() {
    const { cloudflare, vercel, azure } = config.analytics.providers;
    const missing: Array<{ name: string; requires: string[] }> = [];

    if (!cloudflare.apiToken) {
      missing.push({
        name: 'Cloudflare R2 operations (Class A / Class B)',
        requires: ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'],
      });
    }
    if (!vercel.token) {
      missing.push({
        name: 'Vercel usage and plan limits',
        requires: ['VERCEL_TOKEN', 'VERCEL_TEAM_ID'],
      });
    }
    if (!azure.subscriptionId || !azure.clientSecret) {
      missing.push({
        name: 'Azure credit balance and spend',
        requires: [
          'AZURE_TENANT_ID',
          'AZURE_CLIENT_ID',
          'AZURE_CLIENT_SECRET',
          'AZURE_SUBSCRIPTION_ID',
        ],
      });
    }
    return missing;
  }

  /**
   * Database: connectivity, latency, on-disk size, and live pool saturation.
   *
   * The size and row estimates come from Postgres' own catalog rather than
   * `count(*)` over every table, so this stays cheap as the data grows.
   */
  private async probeDatabase(): Promise<ServiceReport> {
    const started = Date.now();
    try {
      const [sizeRow] = await this.prisma.$queryRawUnsafe<
        Array<{ bytes: bigint; name: string }>
      >(
        // Both cast explicitly: `current_database()` is Postgres' `name` type
        // and `current_setting` returns text, neither of which the driver can
        // deserialize into a Prisma scalar as-is.
        `SELECT pg_database_size(current_database())::bigint AS bytes,
                current_database()::text AS name`,
      );

      const [conns] = await this.prisma.$queryRawUnsafe<
        Array<{ used: bigint; ceiling: string }>
      >(
        `SELECT (SELECT count(*) FROM pg_stat_activity)::bigint AS used,
                current_setting('max_connections')::text AS ceiling`,
      );

      const latencyMs = Date.now() - started;
      const pool = this.prisma.getPoolStats();

      return {
        name: 'PostgreSQL',
        state: 'UP',
        latencyMs,
        detail: sizeRow?.name ?? undefined,
        metrics: [
          {
            label: 'Database size',
            value: Number(sizeRow?.bytes ?? 0),
            unit: 'bytes',
          },
          {
            label: 'Server connections',
            value: Number(conns?.used ?? 0),
            unit: 'count',
            limit: Number.parseInt(conns?.ceiling ?? '', 10) || null,
          },
          /*
           * Instantaneous, and read straight after this probe's own queries
           * released their connection — so on a quiet deployment it is
           * legitimately 0 almost every time. It is kept because a non-zero
           * reading is genuinely informative, but the peak beneath it is the
           * row that shows whether the pool is ever under pressure.
           *
           * Measured against `max`, the pool's ceiling, rather than the number
           * of connections currently open.
           */
          {
            label: 'Pool in use',
            value: pool.active,
            unit: 'count',
            limit: pool.max,
          },
          {
            label: 'Pool peak in use',
            value: pool.peakActive,
            unit: 'count',
            limit: pool.max,
          },
          { label: 'Pool idle', value: pool.idle, unit: 'count' },
          // Sustained non-zero waiting means queries are queueing for a
          // connection rather than running slowly — a different problem. The
          // peak is what catches a burst that has already passed.
          { label: 'Pool waiting', value: pool.waiting, unit: 'count' },
          { label: 'Pool peak waiting', value: pool.peakWaiting, unit: 'count' },
          { label: 'Query latency', value: latencyMs, unit: 'ms' },
        ],
      };
    } catch (error) {
      return {
        name: 'PostgreSQL',
        state: 'DOWN',
        detail: (error as Error).message,
      };
    }
  }

  /**
   * Redis: a real `PING` plus the server's own `INFO` counters.
   *
   * The previous platform-status check reported Redis UP whenever a URL was
   * configured, with a latency of zero — it never opened a connection. This
   * one round-trips, so a Redis that is configured but unreachable now reads
   * DOWN instead of healthy.
   */
  private async probeRedis(): Promise<ServiceReport> {
    const client = this.redisService.getClient();
    if (!client) {
      return {
        name: 'Redis',
        state: 'NOT_CONFIGURED',
        detail: 'REDIS_URL is not set — running without a shared cache',
      };
    }

    const started = Date.now();
    try {
      await client.ping();
      const latencyMs = Date.now() - started;

      const [memoryInfo, clientsInfo, statsInfo, keyCount] = await Promise.all([
        client.info('memory'),
        client.info('clients'),
        client.info('stats'),
        client.dbsize(),
      ]);

      const used = numberFromInfo(memoryInfo, 'used_memory');
      const peak = numberFromInfo(memoryInfo, 'used_memory_peak');
      const maxMemory = numberFromInfo(memoryInfo, 'maxmemory');
      const connected = numberFromInfo(clientsInfo, 'connected_clients');
      const hits = numberFromInfo(statsInfo, 'keyspace_hits');
      const misses = numberFromInfo(statsInfo, 'keyspace_misses');
      const lookups = (hits ?? 0) + (misses ?? 0);

      const metrics: ServiceReport['metrics'] = [
        {
          label: 'Memory used',
          value: used ?? 0,
          unit: 'bytes',
          // maxmemory is 0 when no cap is configured; report that as "no
          // ceiling" rather than as a limit of zero.
          limit: maxMemory ? maxMemory : null,
        },
        { label: 'Memory peak', value: peak ?? 0, unit: 'bytes' },
        { label: 'Keys', value: keyCount, unit: 'count' },
        { label: 'Connected clients', value: connected ?? 0, unit: 'count' },
        { label: 'Ping latency', value: latencyMs, unit: 'ms' },
      ];

      if (lookups > 0) {
        metrics.push({
          label: 'Cache hit rate',
          value: Math.round(((hits ?? 0) / lookups) * 1000) / 10,
          unit: 'percent',
        });
      }

      return { name: 'Redis', state: 'UP', latencyMs, metrics };
    } catch (error) {
      return {
        name: 'Redis',
        state: 'DOWN',
        detail: (error as Error).message,
      };
    }
  }

  /**
   * Cloudflare R2: reachability and stored bytes, over the S3 API.
   *
   * Storage size is summed by listing the bucket, which is the only figure the
   * S3-compatible credentials expose. Class A / Class B operation counts are
   * billing analytics and live behind Cloudflare's GraphQL API with a separate
   * token; without it they are reported as unconfigured rather than guessed.
   *
   * The listing is bounded — a bucket larger than the cap reports the bytes it
   * counted and flags the figure as partial, instead of walking a million keys
   * on every page load.
   */
  private async probeR2(): Promise<ServiceReport> {
    const { accountId, accessKeyId, secretAccessKey, bucketName } =
      config.storage.r2;

    if (!accountId || !accessKeyId || !secretAccessKey) {
      return {
        name: 'Cloudflare R2',
        state: 'NOT_CONFIGURED',
        detail: 'R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY unset',
      };
    }

    const started = Date.now();
    try {
      const s3 = this.getR2Client(accountId, accessKeyId, secretAccessKey);
      await s3.send(new HeadBucketCommand({ Bucket: bucketName }));
      const latencyMs = Date.now() - started;

      const MAX_PAGES = config.analytics.r2MaxListPages;
      let bytes = 0;
      let objects = 0;
      let token: string | undefined;
      let truncated = false;

      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await s3.send(
          new ListObjectsV2Command({
            Bucket: bucketName,
            ContinuationToken: token,
          }),
        );
        for (const item of res.Contents ?? []) {
          bytes += item.Size ?? 0;
          objects += 1;
        }
        if (!res.IsTruncated) {
          token = undefined;
          break;
        }
        token = res.NextContinuationToken;
        if (page === MAX_PAGES - 1) truncated = true;
      }

      return {
        name: 'Cloudflare R2',
        state: 'UP',
        latencyMs,
        detail: truncated
          ? `${bucketName} — partial scan, first ${MAX_PAGES * 1000} objects`
          : bucketName,
        metrics: [
          { label: 'Storage used', value: bytes, unit: 'bytes' },
          { label: 'Objects', value: objects, unit: 'count' },
          { label: 'Bucket latency', value: latencyMs, unit: 'ms' },
        ],
      };
    } catch (error) {
      return {
        name: 'Cloudflare R2',
        state: 'DOWN',
        detail: (error as Error).message,
      };
    }
  }

  private getR2Client(
    accountId: string,
    accessKeyId: string,
    secretAccessKey: string,
  ): S3Client {
    if (!this.r2Client) {
      this.r2Client = new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId, secretAccessKey },
      });
    }
    return this.r2Client;
  }

  /**
   * Email transport — the one this deployment actually sends through.
   *
   * Which transport is probed follows `EMAIL_DRIVER`, so production reports on
   * Resend and a developer machine reports on its local inbox, with no code
   * difference between them. Resend is probed for real: an authenticated read
   * of its domains endpoint proves the API is reachable AND that the key works,
   * which a key-presence check cannot. A 401 here is a genuine outage — mail is
   * not being delivered — and reads as such.
   */
  private async probeEmail(): Promise<ServiceReport[]> {
    /*
     * Every transport this deployment can actually send through gets a panel,
     * not just the primary.
     *
     * With a failover configured there are two providers carrying real mail,
     * and the one that matters on a bad day is the one that only runs when the
     * other has already failed. A panel that appears only for the primary would
     * leave the relay's credentials, quota and health invisible until they were
     * urgently needed.
     */
    const primary =
      config.email.driver === 'resend'
        ? await this.probeResend()
        : config.email.driver === 'mailpit'
          ? await this.probeLocalInbox()
          : await this.probeRelay('smtp');

    const hasRelayFallback =
      config.email.fallbackDriver === 'smtp' &&
      config.email.driver !== 'smtp' &&
      config.email.driver !== 'mailpit';

    if (!hasRelayFallback) return [primary];
    return [primary, await this.probeRelay('smtp', { isFallback: true })];
  }

  /**
   * Today's handovers for one provider, as a metric row.
   *
   * Counted by us rather than read from the provider — see EmailUsageService
   * for why. A null count means Redis could not answer, which is reported as
   * such instead of as a confident zero.
   */
  private async sentTodayMetric(
    provider: string,
  ): Promise<NonNullable<ServiceReport['metrics']>> {
    const sent = await this.emailUsage.getSentToday(provider);
    if (sent === null) {
      return [{ label: 'Sent today', value: 'unavailable', unit: 'text' }];
    }
    return [{ label: 'Sent today', value: sent, unit: 'count' }];
  }

  private async probeResend(): Promise<ServiceReport> {
    const apiKey = config.email.resend.apiKey;
    if (!apiKey) {
      return {
        name: 'Email (Resend)',
        state: 'NOT_CONFIGURED',
        detail: 'RESEND_API_KEY is not set',
      };
    }

    const started = Date.now();
    try {
      const response = await fetchWithTimeout(
        `${config.analytics.resendApiUrl}/domains`,
        { headers: { Authorization: `Bearer ${apiKey}` } },
        config.analytics.probeTimeoutMs,
      );
      const latencyMs = Date.now() - started;

      if (!response.ok) {
        return {
          name: 'Email (Resend)',
          state: 'DOWN',
          latencyMs,
          detail:
            response.status === 401 || response.status === 403
              ? `API key rejected (HTTP ${response.status}) — mail will not send`
              : `Resend API returned HTTP ${response.status}`,
        };
      }

      const body = (await response.json().catch(() => ({}))) as {
        data?: Array<{ name?: string; status?: string }>;
      };
      const domains = body.data ?? [];
      const verified = domains.filter((d) => d.status === 'verified');

      return {
        name: 'Email (Resend)',
        state: 'UP',
        latencyMs,
        // The sending domain must be verified or Resend rejects every send with
        // a 403, so this is the figure worth surfacing.
        detail: config.email.fromEmail || undefined,
        metrics: [
          ...(await this.sentTodayMetric('resend')),
          { label: 'Verified domains', value: verified.length, unit: 'count' },
          { label: 'Domains configured', value: domains.length, unit: 'count' },
          { label: 'API latency', value: latencyMs, unit: 'ms' },
        ],
      };
    } catch (error) {
      return {
        name: 'Email (Resend)',
        state: 'DOWN',
        detail: (error as Error).message,
      };
    }
  }

  /**
   * The local development inbox (Mailpit).
   *
   * `EMAIL_DRIVER=mailpit` is rejected outright in staging and production, so
   * this branch only ever runs on a developer machine. An unreachable local
   * inbox is not a production incident, so it reports as unconfigured rather
   * than as an outage — a red panel here would train people to ignore red
   * panels.
   */
  private async probeLocalInbox(): Promise<ServiceReport> {
    const report = await this.probeSmtp('Email (Mailpit — local)');
    if (report.state === 'DOWN') {
      return {
        name: report.name,
        state: 'NOT_CONFIGURED',
        detail:
          'Local development inbox is not running. Production sends through Resend.',
      };
    }
    return report;
  }

  /**
   * The SMTP relay, whether it is the primary transport or the failover.
   *
   * Two independent things are checked, and they can disagree:
   *
   *   - the relay itself, by opening the SMTP connection. This is what decides
   *     whether mail can actually be sent, so it decides the panel's state.
   *   - the provider's REST API, for quota and the provider's own view of the
   *     day. This needs a separate API key that a deployment may not have set,
   *     and its absence is NOT an outage — the relay sends perfectly well
   *     without anyone having configured reporting.
   */
  private async probeRelay(
    usageProvider: string,
    { isFallback = false }: { isFallback?: boolean } = {},
  ): Promise<ServiceReport> {
    const host = config.email.smtp.host || '';
    // Named from the host so the panel says who it is rather than "SMTP".
    const vendor = /brevo|sendinblue/i.test(host) ? 'Brevo' : 'SMTP relay';
    const name = isFallback
      ? `Email (${vendor} — failover)`
      : `Email (${vendor})`;

    const report = await this.probeSmtp(name);
    const metrics = [
      ...(report.metrics ?? []),
      ...(await this.sentTodayMetric(usageProvider)),
    ];

    const vendorMetrics = /brevo|sendinblue/i.test(host)
      ? await this.brevoUsage()
      : [];

    return {
      ...report,
      detail:
        report.detail ??
        (isFallback
          ? `Used when ${config.email.driver} fails`
          : undefined),
      metrics: [...metrics, ...vendorMetrics],
    };
  }

  /**
   * Brevo's own figures: the day's requests and what is left of the plan.
   *
   * Best-effort by design. No key, an unreachable API or a response shape this
   * does not recognise all return no rows rather than an error — the relay's
   * health is decided by the SMTP probe above, and a reporting gap must not
   * make a working mail path look broken.
   */
  private async brevoUsage(): Promise<NonNullable<ServiceReport['metrics']>> {
    const apiKey = config.analytics.providers.brevo.apiKey;
    if (!apiKey) return [];

    const today = new Date().toISOString().slice(0, 10);
    const headers = { 'api-key': apiKey, accept: 'application/json' };
    const out: NonNullable<ServiceReport['metrics']> = [];

    try {
      const res = await fetchWithTimeout(
        `${config.analytics.brevoApiUrl}/smtp/statistics/aggregatedReport?startDate=${today}&endDate=${today}`,
        { headers },
        config.analytics.probeTimeoutMs,
      );
      if (res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          requests?: number;
          delivered?: number;
        };
        if (typeof body.requests === 'number') {
          out.push({
            label: 'Brevo requests today',
            value: body.requests,
            unit: 'count',
          });
        }
        if (typeof body.delivered === 'number') {
          out.push({
            label: 'Brevo delivered today',
            value: body.delivered,
            unit: 'count',
          });
        }
      }
    } catch {
      // Reporting is a nicety; the SMTP probe already answered the real question.
    }

    try {
      const res = await fetchWithTimeout(
        `${config.analytics.brevoApiUrl}/account`,
        { headers },
        config.analytics.probeTimeoutMs,
      );
      if (res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          plan?: Array<{ type?: string; credits?: number }>;
        };
        // Brevo reports several plan rows; the transactional email one is the
        // only one that governs whether a send succeeds.
        const emailPlan = (body.plan ?? []).find(
          (p) => typeof p?.credits === 'number' && /email|sms|free/i.test(p.type ?? ''),
        );
        if (emailPlan && typeof emailPlan.credits === 'number') {
          out.push({
            label: 'Brevo credits left',
            value: emailPlan.credits,
            unit: 'count',
          });
        }
      }
    } catch {
      // As above.
    }

    return out;
  }

  private async probeSmtp(name: string): Promise<ServiceReport> {
    const { host, port } = config.email.smtp;
    if (!host) {
      return { name, state: 'NOT_CONFIGURED', detail: 'SMTP_HOST is not set' };
    }

    const started = Date.now();
    try {
      await tcpProbe(host, port, config.analytics.probeTimeoutMs);
      const latencyMs = Date.now() - started;
      return {
        name,
        state: 'UP',
        latencyMs,
        detail: `${host}:${port}`,
        metrics: [{ label: 'Connect latency', value: latencyMs, unit: 'ms' }],
      };
    } catch (error) {
      return {
        name,
        state: 'DOWN',
        detail: `${host}:${port} — ${(error as Error).message}`,
      };
    }
  }

  /**
   * Slow requests recorded in the retention window.
   *
   * Every row here was measured by the server middleware around a real
   * request; there is no client-reported timing in this table.
   */
  /**
   * Application errors from the retention window, newest first.
   *
   * Reads the same table the exception filter writes to, so this is the record
   * of what actually failed rather than a re-derivation. The window is the
   * retention window: there is nothing older to show, because the sweep has
   * deleted it.
   */
  async getErrorLogs(params: {
    page?: number;
    limit?: number;
    route?: string;
    severity?: string;
    statusCode?: number;
    search?: string;
  }) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 25));

    const { retentionDays } = config.observability.errorLogs;
    const since = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    // Every clause is anchored to `since`. Without it a filter could reach rows
    // the sweep has not collected yet and the view would claim a longer history
    // than it actually keeps.
    const where: any = { occurredAt: { gte: since } };
    if (params.route) where.route = { contains: params.route, mode: 'insensitive' };
    if (params.severity === 'UNEXPECTED' || params.severity === 'EXPECTED') {
      where.severity = params.severity;
    }
    if (params.statusCode) where.statusCode = params.statusCode;
    if (params.search) {
      where.OR = [
        { message: { contains: params.search, mode: 'insensitive' } },
        { path: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    const [total, rows, byRoute, unexpected, expected, firstSeen] =
      await Promise.all([
        this.prisma.errorLog.count({ where }),
        this.prisma.errorLog.findMany({
          where,
          orderBy: { occurredAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        // The grouping answers the question the list cannot: is this one fault
        // happening repeatedly, or many different ones?
        this.prisma.errorLog.groupBy({
          by: ['route'],
          where,
          _count: { _all: true },
          _max: { occurredAt: true },
          orderBy: { _count: { route: 'desc' } },
          take: 10,
        }),
        this.prisma.errorLog.count({
          where: { occurredAt: { gte: since }, severity: 'UNEXPECTED' },
        }),
        this.prisma.errorLog.count({
          where: { occurredAt: { gte: since }, severity: 'EXPECTED' },
        }),
        this.prisma.errorLog.findFirst({
          where: { occurredAt: { gte: since } },
          orderBy: { occurredAt: 'asc' },
          select: { occurredAt: true },
        }),
      ]);

    return {
      rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
      summary: {
        retentionDays,
        since: since.toISOString(),
        // What the table actually holds, which on a young deployment is far
        // less than the window. Saying "7 days" over two days of data invites
        // the wrong conclusion from a low count.
        oldestRecorded: firstSeen?.occurredAt?.toISOString() ?? null,
        total,
        unexpected,
        expected,
        captureEnabled: config.observability.errorLogs.enabled,
        clientErrorsCaptured: config.observability.errorLogs.captureClientErrors,
      },
      topRoutes: byRoute.map((r: any) => ({
        route: r.route,
        count: r._count._all,
        lastSeen: r._max.occurredAt,
      })),
    };
  }

  async getSlowRequests(params: {
    page?: number;
    limit?: number;
    route?: string;
    method?: string;
    surface?: SlowRequestSurface;
  }) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 25));
    const surface: SlowRequestSurface =
      params.surface === 'admin' || params.surface === 'app'
        ? params.surface
        : 'all';

    const where: any = { ...surfaceFilter(surface) };
    if (params.route) {
      where.route = { contains: params.route, mode: 'insensitive' };
    }
    if (params.method) where.method = params.method.toUpperCase();

    // Section totals are counted independently of the active section, so the
    // tab labels stay accurate while looking at either one.
    const [total, rows, slowest, byRoute, adminTotal, appTotal] =
      await Promise.all([
        this.prisma.slowRequest.count({ where }),
        this.prisma.slowRequest.findMany({
          where,
          orderBy: { occurredAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.prisma.slowRequest.aggregate({
          where,
          _max: { durationMs: true },
          _avg: { durationMs: true },
        }),
        this.prisma.slowRequest.groupBy({
          by: ['route'],
          where,
          _count: { _all: true },
          _avg: { durationMs: true },
          _max: { durationMs: true },
          orderBy: { _count: { route: 'desc' } },
          take: 10,
        }),
        this.prisma.slowRequest.count({ where: surfaceFilter('admin') }),
        this.prisma.slowRequest.count({ where: surfaceFilter('app') }),
      ]);

    return {
      data: rows,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        thresholdMs: config.observability.slowRequests.thresholdMs,
        retentionDays: config.observability.slowRequests.retentionDays,
        // So the page can say "since <date>" truthfully rather than implying
        // the table covers all time.
        windowStart: this.retention.cutoff.toISOString(),
        surface,
        surfaceCounts: {
          all: adminTotal + appTotal,
          admin: adminTotal,
          app: appTotal,
        },
        slowestMs: slowest._max.durationMs ?? null,
        averageMs: slowest._avg.durationMs
          ? Math.round(slowest._avg.durationMs)
          : null,
      },
      topRoutes: byRoute.map((row) => ({
        route: row.route,
        count: row._count._all,
        avgMs: Math.round(row._avg.durationMs ?? 0),
        maxMs: row._max.durationMs ?? 0,
      })),
    };
  }
}

/** Pull `key:value` out of a Redis INFO section. */
function numberFromInfo(info: string, key: string): number | null {
  const match = info.match(new RegExp(`^${key}:(\\d+)`, 'm'));
  return match ? Number.parseInt(match[1], 10) : null;
}

/** `fetch` that gives up rather than hanging a page load on a slow provider. */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Resolves when a TCP connection opens; rejects on error or timeout. */
async function tcpProbe(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<void> {
  const { connect } = await import('node:net');
  await new Promise<void>((resolve, reject) => {
    const socket = connect({ host, port });
    const done = (err?: Error) => {
      socket.removeAllListeners();
      socket.destroy();
      err ? reject(err) : resolve();
    };
    socket.setTimeout(timeoutMs, () => done(new Error('connection timed out')));
    socket.once('connect', () => done());
    socket.once('error', (err) => done(err));
  });
}
