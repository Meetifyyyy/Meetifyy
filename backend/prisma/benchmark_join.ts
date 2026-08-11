/**
 * Benchmarks join/leave activity endpoints under:
 *   1. Single request
 *   2. Rapid duplicate requests (concurrency-safety test)
 *
 * Usage:
 *   $env:API_BASE="http://localhost:3001"; $env:JWT="<token>"; $env:ACTIVITY_ID="<id>"
 *   npx ts-node --transpile-only prisma/benchmark_join.ts
 */

const BASE    = process.env.API_BASE    ?? 'http://localhost:3001';
const TOKEN   = process.env.JWT         ?? '';
const ACT_ID  = process.env.ACTIVITY_ID ?? '';

if (!TOKEN || !ACT_ID) {
  console.error('Set JWT and ACTIVITY_ID env vars');
  process.exit(1);
}

const headers = {
  'Authorization': `Bearer ${TOKEN}`,
  'Content-Type':  'application/json',
};

async function hit(method: string, path: string): Promise<{ status: number; ms: number }> {
  const t0 = Date.now();
  const res = await fetch(`${BASE}${path}`, { method, headers });
  return { status: res.status, ms: Date.now() - t0 };
}

async function run() {
  console.log('\n=== Single join/leave round-trip ===');
  const j1 = await hit('POST', `/api/activities/${ACT_ID}/join`);
  console.log(`JOIN  -> ${j1.status}  ${j1.ms}ms`);
  const l1 = await hit('POST', `/api/activities/${ACT_ID}/leave`);
  console.log(`LEAVE -> ${l1.status}  ${l1.ms}ms`);

  console.log('\n=== Rapid duplicate join (concurrency safety) ===');
  const [r1, r2, r3] = await Promise.all([
    hit('POST', `/api/activities/${ACT_ID}/join`),
    hit('POST', `/api/activities/${ACT_ID}/join`),
    hit('POST', `/api/activities/${ACT_ID}/join`),
  ]);
  console.log(`JOIN x3 -> ${r1.status} ${r1.ms}ms | ${r2.status} ${r2.ms}ms | ${r3.status} ${r3.ms}ms`);
  // All should be 200/201, none should be 400

  console.log('\n=== Rapid duplicate leave (idempotency) ===');
  const [d1, d2] = await Promise.all([
    hit('POST', `/api/activities/${ACT_ID}/leave`),
    hit('POST', `/api/activities/${ACT_ID}/leave`),
  ]);
  console.log(`LEAVE x2 -> ${d1.status} ${d1.ms}ms | ${d2.status} ${d2.ms}ms`);

  console.log('\n=== 10 sequential join/leave cycles ===');
  let totalMs = 0;
  for (let i = 0; i < 10; i++) {
    const j = await hit('POST', `/api/activities/${ACT_ID}/join`);
    const l = await hit('POST', `/api/activities/${ACT_ID}/leave`);
    const cycleMs = j.ms + l.ms;
    totalMs += cycleMs;
    console.log(`  cycle ${i + 1}: join=${j.ms}ms leave=${l.ms}ms total=${cycleMs}ms`);
  }
  console.log(`\nAvg cycle: ${(totalMs / 10).toFixed(0)}ms`);
}

run().catch(console.error);
