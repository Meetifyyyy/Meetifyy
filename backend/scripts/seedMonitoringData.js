/* eslint-disable no-console */
/**
 * Generates realistic monitoring rows so the dashboard can be built and
 * reviewed before real traffic exists.
 *
 * Usage:
 *   node scripts/seedMonitoringData.js            # 24 hours of history
 *   node scripts/seedMonitoringData.js --hours 72
 *   node scripts/seedMonitoringData.js --clear    # remove seeded rows only
 *
 * The shapes are deliberately uneven - a daily traffic curve, a couple of
 * endpoints that are genuinely slow, and one burst of errors - because a
 * dashboard tested against flat uniform data hides exactly the problems it is
 * supposed to make visible.
 *
 * Seeded rows carry a marker in `requestId` so `--clear` can remove them
 * without touching anything real that has since arrived.
 */
require('dotenv').config({ quiet: true });
const { PrismaClient } = require('@prisma/client');

/**
 * Bulk backfill goes over the direct connection when one is configured.
 *
 * The pooled URL runs in transaction mode, where Prisma's default engine reuses
 * named prepared statements across multiplexed backends and fails with
 * "prepared statement already exists". The application avoids this with a
 * driver adapter; a one-off script is simpler to point at the direct URL, which
 * is also the right choice for a large insert - it keeps the backfill out of
 * the pool the live app is sharing.
 */
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } },
});
const SEED_MARKER = 'seed-';

/** Endpoints with plausible traffic shares and latency profiles. */
const ROUTES = [
  { method: 'GET', route: '/api/posts', weight: 22, baseMs: 90, spreadMs: 70 },
  { method: 'GET', route: '/api/posts/:id', weight: 14, baseMs: 70, spreadMs: 50 },
  { method: 'POST', route: '/api/posts', weight: 5, baseMs: 220, spreadMs: 140 },
  { method: 'GET', route: '/api/messages/:id', weight: 16, baseMs: 60, spreadMs: 40 },
  { method: 'POST', route: '/api/messages', weight: 9, baseMs: 130, spreadMs: 90 },
  { method: 'GET', route: '/api/communities', weight: 8, baseMs: 110, spreadMs: 80 },
  { method: 'GET', route: '/api/notifications', weight: 10, baseMs: 75, spreadMs: 45 },
  { method: 'GET', route: '/api/support/help', weight: 4, baseMs: 140, spreadMs: 90 },
  { method: 'POST', route: '/api/auth/login', weight: 5, baseMs: 260, spreadMs: 180 },
  // The deliberately slow one, so the slow-endpoints table has something real
  // to surface.
  { method: 'GET', route: '/api/search', weight: 7, baseMs: 850, spreadMs: 600 },
];

const ERROR_MESSAGES = [
  { status: 401, message: 'Super Admin authentication required' },
  { status: 403, message: 'CSRF validation failed' },
  { status: 404, message: 'Ticket not found' },
  { status: 429, message: 'Too Many Requests' },
  { status: 500, message: 'Connection pool timeout' },
  { status: 502, message: 'Upstream request failed' },
];

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const randomBetween = (min, max) => min + Math.random() * (max - min);

function pickRoute() {
  const total = ROUTES.reduce((sum, r) => sum + r.weight, 0);
  let roll = Math.random() * total;
  for (const route of ROUTES) {
    roll -= route.weight;
    if (roll <= 0) return route;
  }
  return ROUTES[0];
}

/** Traffic curve: quiet overnight, busy late afternoon. */
function trafficMultiplier(date) {
  const hour = date.getUTCHours();
  return 0.25 + 0.75 * Math.sin(((hour - 3 + 24) % 24) / 24 * Math.PI) ** 2;
}

async function clear() {
  const where = { requestId: { startsWith: SEED_MARKER } };
  const [requests, errors] = await Promise.all([
    prisma.requestLog.deleteMany({ where }),
    prisma.errorLog.deleteMany({ where }),
  ]);
  // System metrics carry no marker, so only the synthetic backfill window is
  // cleared - anything the live collector has written since is left alone.
  const metrics = await prisma.systemMetric.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - 60 * 1000) } },
  });
  console.log(`Removed ${requests.count} requests, ${errors.count} errors, ${metrics.count} metrics.`);
}

async function seed(hours) {
  const now = Date.now();
  const startedAt = now - hours * 60 * 60 * 1000;

  // One burst of failures, so the error-rate chart has a spike to show rather
  // than a flat line of background noise.
  const incidentStart = now - Math.floor(hours * 0.35) * 60 * 60 * 1000;
  const incidentEnd = incidentStart + 25 * 60 * 1000;

  const requests = [];
  const errors = [];
  const metrics = [];

  // ── Requests, minute by minute ─────────────────────────────────────────
  for (let t = startedAt; t < now; t += 60 * 1000) {
    const at = new Date(t);
    const inIncident = t >= incidentStart && t <= incidentEnd;
    const count = Math.round(randomBetween(4, 18) * trafficMultiplier(at));

    for (let i = 0; i < count; i++) {
      const spec = pickRoute();
      const createdAt = new Date(t + Math.floor(Math.random() * 60 * 1000));

      // Log-normal-ish: most requests near the base, a long right tail, which
      // is what makes p95 differ from the mean the way real traffic does.
      const tail = Math.random() < 0.08 ? randomBetween(2, 6) : 1;
      const durationMs = Math.max(1, Math.round((spec.baseMs + randomBetween(-spec.spreadMs, spec.spreadMs)) * tail));

      const failed = inIncident ? Math.random() < 0.35 : Math.random() < 0.02;
      const failure = ERROR_MESSAGES[Math.floor(Math.random() * ERROR_MESSAGES.length)];
      const statusCode = failed ? failure.status : spec.method === 'POST' ? 201 : 200;
      const requestId = `${SEED_MARKER}${createdAt.getTime()}-${i}`;

      requests.push({
        requestId,
        method: spec.method,
        route: spec.route,
        statusCode,
        durationMs,
        responseSize: Math.round(randomBetween(200, 24_000)),
        userId: Math.random() < 0.6 ? `seed-user-${Math.floor(Math.random() * 40)}` : null,
        createdAt,
      });

      if (failed) {
        errors.push({
          requestId,
          route: spec.route,
          statusCode: failure.status,
          message: failure.message,
          stack: null,
          createdAt,
        });
      }
    }
  }

  // ── System snapshots every 15 minutes ──────────────────────────────────
  for (let t = startedAt; t < now; t += 15 * 60 * 1000) {
    const at = new Date(t);
    const load = trafficMultiplier(at);
    const inIncident = t >= incidentStart && t <= incidentEnd;

    metrics.push({
      memoryRssMb: Math.round(randomBetween(220, 340) + load * 90),
      memoryHeapUsedMb: Math.round(randomBetween(90, 160) + load * 60),
      cpuPercent: Math.round((randomBetween(6, 25) + load * 35 + (inIncident ? 40 : 0)) * 100) / 100,
      eventLoopLagMs: Math.round((randomBetween(0.4, 4) + (inIncident ? 45 : 0)) * 100) / 100,
      dbPoolActive: Math.round(randomBetween(1, 6) + load * 5 + (inIncident ? 6 : 0)),
      dbPoolIdle: Math.round(randomBetween(2, 8)),
      dbPoolWaiting: inIncident ? Math.round(randomBetween(1, 5)) : 0,
      socketConnections: Math.round(randomBetween(5, 40) + load * 90),
      createdAt: at,
    });
  }

  // Chunked so a large backfill does not build one enormous statement.
  const insert = async (label, rows, delegate) => {
    for (let i = 0; i < rows.length; i += 500) {
      await delegate.createMany({ data: rows.slice(i, i + 500), skipDuplicates: true });
    }
    console.log(`  ${label}: ${rows.length}`);
  };

  console.log(`Seeding ${hours}h of monitoring data...`);
  await insert('request logs', requests, prisma.requestLog);
  await insert('error logs', errors, prisma.errorLog);
  await insert('system metrics', metrics, prisma.systemMetric);

  const errorRate = ((errors.length / Math.max(1, requests.length)) * 100).toFixed(1);
  console.log(`Done. Overall error rate ${errorRate}%, with a burst around ${new Date(incidentStart).toISOString()}.`);
}

(async () => {
  try {
    if (process.argv.includes('--clear')) await clear();
    else await seed(Math.max(1, parseInt(arg('hours', '24'), 10)));
  } catch (error) {
    console.error('Seed failed:', error.message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
