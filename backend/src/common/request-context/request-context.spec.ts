import compression from 'compression';
import express from 'express';
import type { Request } from 'express';
import request from 'supertest';
import { httpLine } from '../logging/log-format';
import {
  recordDbOperation,
  requestContextMiddleware,
  requestDbStats,
  runWithDbStats,
  serverTimingValue,
  type RequestDbStats,
} from './request-context';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** An app whose routes "query" a given number of times, on interleaved timers. */
function appWith(options: { serverTiming: boolean }) {
  const app = express();
  const logged: string[] = [];
  app.use(requestContextMiddleware(options));
  // The access log, as app.module builds it: after the response is written.
  app.use((req, res, next) => {
    res.on('finish', () => {
      const stats = requestDbStats(req);
      logged.push(
        httpLine({
          method: req.method,
          url: req.url,
          status: res.statusCode,
          dbQueries: stats?.queries,
          dbMs: stats?.dbMs,
        }),
      );
    });
    next();
  });
  app.get('/queries/:n', async (req, res) => {
    for (let i = 0; i < Number(req.params.n); i++) {
      await sleep(3);
      recordDbOperation(2);
    }
    res.json({ ok: true });
  });
  app.get('/fails', (_req, res) => {
    recordDbOperation(1);
    res.status(500).end();
  });
  return { app, logged };
}

describe('request context', () => {
  describe('per-request counters', () => {
    it('gives concurrent requests their own counts', async () => {
      const { app, logged } = appWith({ serverTiming: true });
      const [one, five, three] = await Promise.all([
        request(app).get('/queries/1'),
        request(app).get('/queries/5'),
        request(app).get('/queries/3'),
      ]);
      expect(one.headers['server-timing']).toContain('desc="1 query"');
      expect(five.headers['server-timing']).toContain('desc="5 queries"');
      expect(three.headers['server-timing']).toContain('desc="3 queries"');
      // Each recorded 2 ms per query, so the totals cannot have been shared.
      expect(five.headers['server-timing']).toContain('dur=10.0');
      expect(three.headers['server-timing']).toContain('dur=6.0');
      await sleep(10);
      expect(logged.some((l) => /\/queries\/5 .*q=5 db=10ms/.test(l))).toBe(
        true,
      );
    });

    it('puts q= and db= on the access log line', async () => {
      const { app, logged } = appWith({ serverTiming: false });
      await request(app).get('/queries/4');
      await sleep(10);
      expect(logged).toHaveLength(1);
      expect(logged[0]).toContain('q=4');
      expect(logged[0]).toContain('db=8ms');
    });

    it('counts nothing, and does not throw, outside a request', () => {
      const bystander: RequestDbStats = { queries: 0, dbMs: 0 };
      runWithDbStats(() => undefined, bystander);
      expect(() => recordDbOperation(5)).not.toThrow();
      expect(bystander).toEqual({ queries: 0, dbMs: 0 });
    });

    it("finds the counters from the raw request and from pino-http's wrapper", async () => {
      const found: Array<RequestDbStats | undefined> = [];
      const app = express();
      app.use(requestContextMiddleware({ serverTiming: false }));
      app.get('/', (req: Request, res) => {
        recordDbOperation(1);
        found.push(requestDbStats(req), requestDbStats({ raw: req }));
        res.end();
      });
      await request(app).get('/');
      expect(found[0]).toEqual({ queries: 1, dbMs: 1 });
      expect(found[1]).toBe(found[0]);
      expect(requestDbStats({})).toBeUndefined();
      expect(requestDbStats(undefined)).toBeUndefined();
    });
  });

  describe('Server-Timing', () => {
    it('is sent outside production', async () => {
      const { app } = appWith({ serverTiming: true });
      const res = await request(app).get('/queries/2');
      expect(res.headers['server-timing']).toBe('db;dur=4.0;desc="2 queries"');
    });

    it('is sent on an error response too, and for a request with no queries', async () => {
      const { app } = appWith({ serverTiming: true });
      const failed = await request(app).get('/fails');
      expect(failed.status).toBe(500);
      expect(failed.headers['server-timing']).toBe('db;dur=1.0;desc="1 query"');
      const none = await request(app).get('/queries/0');
      expect(none.headers['server-timing']).toBe('db;dur=0.0;desc="0 queries"');
    });

    it('survives the compression middleware main.ts mounts after it', async () => {
      const app = express();
      app.use(requestContextMiddleware({ serverTiming: true }));
      app.use(compression({ level: 6, threshold: 1024 }));
      app.get('/big', (_req, res) => {
        recordDbOperation(3);
        res.json({ filler: 'x'.repeat(5000) });
      });
      const res = await request(app).get('/big');
      expect(res.headers['content-encoding']).toBe('gzip');
      expect(res.headers['server-timing']).toBe('db;dur=3.0;desc="1 query"');
    });

    it('is absent in production', async () => {
      const { app } = appWith({ serverTiming: false });
      const res = await request(app).get('/queries/2');
      expect(res.status).toBe(200);
      expect(res.headers['server-timing']).toBeUndefined();
    });

    it('formats the value the way browsers parse it', () => {
      expect(serverTimingValue({ queries: 1, dbMs: 12.34 })).toBe(
        'db;dur=12.3;desc="1 query"',
      );
    });
  });
});
