import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { config } from '../config';
import { dbLine } from '../common/logging/log-format';

/**
 * Connects through node-postgres rather than Prisma's own Rust connection layer.
 *
 * Why: on Supabase's TRANSACTION pooler the Rust path is unusable either way —
 * with `pgbouncer=true` it wraps every query in BEGIN / DEALLOCATE ALL / COMMIT
 * (measured: a 31ms query costs 155ms, a 5x tax on every statement in the app),
 * and without the flag it fails outright (`prepared statement does not exist`,
 * 230 of 300 queries in a concurrency test). node-postgres uses unnamed prepared
 * statements, which are safe under transaction pooling, so neither problem
 * applies — verified at 0 errors on the same 300-query/30-concurrency test.
 *
 * Why transaction mode matters: SESSION mode pins one Postgres connection per
 * client for its whole life, capping the app at Supavisor's `pool_size` (15 on
 * this project) no matter how much the queries are optimised. Transaction mode
 * multiplexes many clients over few server connections, which is what makes
 * concurrency scale past a couple of hundred users.
 */
const buildPool = () => {
  const url = config.database.url;
  // `max` is client-side; under transaction pooling these do NOT map 1:1 to
  // Postgres backends, so this can exceed what session mode allowed.
  const match = url.match(/[?&]connection_limit=(\d+)/);
  const max = match ? Math.max(1, Math.min(parseInt(match[1], 10), 30)) : 15;
  return new Pool({
    connectionString: url,
    max,
    // Supavisor drops idle clients; recycle before it does so a reaped socket
    // never surfaces as a query error.
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: false,
  });
};


/**
 * `SELECT 1` is the pool warm-up and the periodic liveness probe. It fires
 * once per pooled connection, so a 15-connection pool printed fifteen
 * identical lines every cycle and told you nothing.
 */
function isPoolPing(sql: string): boolean {
  return /^\s*SELECT\s+1\s*$/i.test(sql || '');
}

/**
 * Reduce a Prisma statement to `VERB Model` — enough to see what the request
 * touched and in what order, without the generated SQL body.
 */
function summarizeQuery(sql: string): string {
  const q = (sql || '').trim();
  const verb = (q.split(/\s+/, 1)[0] || 'QUERY').toUpperCase();
  const table =
    q.match(/(?:FROM|INTO|UPDATE)\s+"?(?:public"?\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?/i)?.[1];
  return table ? `${verb} ${table}` : verb;
}

@Injectable()
export class PrismaService extends PrismaClient<
  { log: [{ emit: 'event', level: 'query' }, { emit: 'event', level: 'error' }, { emit: 'event', level: 'warn' }] },
  'query' | 'error' | 'warn'
> implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('DB');
  private keepAliveTimer: NodeJS.Timeout | null = null;
  private readonly pool: Pool;

  /**
   * Number of connections to pre-open, read from `connection_limit` on the
   * DATABASE_URL so the warmup always matches the pool actually in use.
   *
   * Under TRANSACTION pooling these are client-side connections that Supavisor
   * multiplexes onto a smaller set of Postgres backends, so this no longer has
   * to stay under the pooler's `pool_size` the way session mode did. (In session
   * mode it did: one client pinned one backend, and exceeding `pool_size` failed
   * every query with `FATAL: (EMAXCONNSESSION) max clients reached`.)
   */
  private getPoolSize(): number {
    const raw = config.database.url;
    const match = raw.match(/[?&]connection_limit=(\d+)/);
    const fromUrl = match ? parseInt(match[1], 10) : NaN;
    const fallback = require('os').cpus().length * 2 + 1;
    const size = Number.isFinite(fromUrl) && fromUrl > 0 ? fromUrl : fallback;
    return Math.max(1, Math.min(size, 30));
  }

  constructor() {
    const pool = buildPool();
    super({
      adapter: new PrismaPg(pool),
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ],
    } as any);
    this.pool = pool;

    // A pool-level error (Supavisor reaping an idle socket, a transient network
    // blip) is emitted on the Pool, not on a query. Without a listener Node
    // treats it as an unhandled 'error' event and terminates the process.
    this.pool.on('error', (err) => {
      this.logger.warn(`Postgres pool error (recovered): ${err.message}`);
    });

    // Handle transient database connection drops with automatic retry
    this.$use(async (params, next) => {
      let retries = 2;
      while (retries >= 0) {
        try {
          return await next(params);
        } catch (error: any) {
          const isConnError =
            error?.code === 'P1001' ||
            error?.code === 'P1002' ||
            error?.code === 'P1008' ||
            error?.code === 'P1017' ||
            (error?.message && (
              error.message.includes("Can't reach database server") ||
              error.message.includes('Timed out fetching a new connection') ||
              error.message.includes('Connection pool timeout') ||
              error.message.includes('EMAXCONNSESSION') ||
              error.message.includes('max clients reached') ||
              error.message.includes('ConnectionReset')
            ));

          if (isConnError && retries > 0) {
            retries--;
            this.logger.warn(`Database transient connection issue (${error.code || 'network'}). Retrying... (${retries} attempts remaining)`);
            await new Promise((res) => setTimeout(res, 200));
            continue;
          }
          throw error;
        }
      }
    });
  }

  /**
   * Live connection-pool counters, for the monitoring dashboard.
   *
   * `pg` exposes total/idle/waiting; "active" is what is left once the idle
   * ones are subtracted. Saturation shows up here as waiting climbing above
   * zero, which is the signal that queries are queueing for a connection
   * rather than running slowly.
   */
  getPoolStats(): { active: number; idle: number; waiting: number; total: number } {
    const total = this.pool.totalCount ?? 0;
    const idle = this.pool.idleCount ?? 0;
    return {
      total,
      idle,
      active: Math.max(0, total - idle),
      waiting: this.pool.waitingCount ?? 0,
    };
  }


  async onModuleInit() {
    const logQueries = config.logging.logQueries;

    // @ts-ignore
    this.$on('query', (e: any) => {
      // A full Prisma-generated SQL string is several hundred characters of
      // JSONB_BUILD_OBJECT and LATERAL joins. Printing one per query buried
      // every line that mattered — errors included — under a wall of SQL. The
      // routine line is now a one-line summary; the full statement is still
      // printed for slow queries, which is the case where you actually need to
      // read it.
      if (e.duration >= config.database.slowQueryMs) {
        this.logger.warn(dbLine(summarizeQuery(e.query), e.duration, `SLOW · ${e.query}`));
      } else if (logQueries && !isPoolPing(e.query)) {
        this.logger.debug(dbLine(summarizeQuery(e.query), e.duration));
      }
    });

    // @ts-ignore
    this.$on('error', (e: any) => {
      // Ignore noisy raw logs for P1001 transient connection drops,
      // as our $use middleware already handles them gracefully with retries.
      if (e.message && (e.message.includes('P1001') || e.message.includes("Can't reach database server"))) {
        return;
      }
      this.logger.error(e.message || e);
    });

    // @ts-ignore
    this.$on('warn', (e: any) => {
      this.logger.warn(e.message || e);
    });

    try {
      await this.$connect();

      // Warm up the connection pool on boot to prevent first-query cold-start
      // delays. This must issue `poolSize` queries CONCURRENTLY: Prisma opens
      // pooled connections lazily and one at a time, so a single `SELECT 1`
      // only ever establishes ONE connection. Every later concurrent query then
      // paid the full connection handshake inline — measured at 150-380ms
      // against the Supabase pooler — which showed up as a large latency spike
      // on the first request to touch each endpoint, and again whenever traffic
      // fanned out wider than the pool had grown.
      const poolSize = this.getPoolSize();
      await Promise.all(
        Array.from({ length: poolSize }, () =>
          this.$queryRawUnsafe('SELECT 1').catch(() => {}),
        ),
      );
      this.logger.log(`Connected and pool warmed up (${poolSize} connections)`);

      // Keepalive to prevent pooler idle-connection drops (P1001). Fans out
      // across the whole pool for the same reason the warmup does — a single
      // serial ping only keeps one connection hot and lets the rest go cold,
      // reintroducing the very handshake cost the warmup just paid.
      this.keepAliveTimer = setInterval(async () => {
        try {
          await Promise.all(
            Array.from({ length: poolSize }, () =>
              this.$queryRawUnsafe('SELECT 1').catch(() => {}),
            ),
          );
        } catch {}
      }, 25000);
    } catch (error) {
      this.logger.error('Could not connect to database on startup.');
      this.logger.debug(error);
    }
  }

  async onModuleDestroy() {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
    await this.$disconnect();
    // The adapter owns this pool, so Prisma's disconnect does not close it —
    // leaving it open holds sockets to the pooler after shutdown.
    await this.pool.end().catch(() => {});
  }
}
