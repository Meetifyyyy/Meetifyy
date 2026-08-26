# Application Monitoring

Application-level observability for Meetifyy, surfaced at **Admin → Monitoring**.

The hosting platform already provides infrastructure logs and metrics: deploys,
crashes, container CPU and memory graphs. This layer deliberately does not
duplicate any of that. It answers the questions the platform cannot:

- which endpoint is slow, and whether it is slow on average or only in the tail
- which endpoint is failing, and what the failure actually said
- how many Socket.IO clients are connected right now
- whether the database pool is saturated
- whether the event loop is blocked

Nothing in this feature calls a hosting provider's API or SDK. It reads Node,
Postgres and Socket.IO primitives only, so it keeps working unchanged if the app
moves host.

---

## Architecture

```
Express/Nest request
  │
  ├─ RequestMonitoringMiddleware ──┐
  ├─ HttpExceptionFilter (cause)   ├──► redactor ──► MonitoringWriterService ──► Postgres
  ├─ SystemMetricsCollector        │                  (buffered, batched)
  └─ SocketMetricsCollector      ──┘                        │
                                                            ▼
        AdminMonitoringController  /admin/monitoring/v1/*  (AdminJwtGuard)
                                                            │
                                                            ▼
                                        Admin Dashboard → Monitoring page
```

### Where things live

| Path | Purpose |
| --- | --- |
| `backend/src/config/monitoring.config.ts` | **Every** env-driven setting. Nothing else reads `process.env`. |
| `backend/src/monitoring/request-monitoring.middleware.ts` | One row per HTTP request, plus an error row for failures. |
| `backend/src/monitoring/utils/redactor.ts` | The denylist and the credential scrubbing. |
| `backend/src/monitoring/services/monitoring-writer.service.ts` | Buffered, batched writes. |
| `backend/src/monitoring/services/system-metrics.collector.ts` | Periodic process/DB snapshot. |
| `backend/src/monitoring/services/socket-metrics.collector.ts` | Live Socket.IO client count. |
| `backend/src/monitoring/services/monitoring-retention.service.ts` | Deletes rows past the retention window. |
| `backend/src/admin/monitoring/` | Read-only admin API. |
| `admin-frontend/src/pages/MonitoringPage.tsx` | The dashboard. |
| `backend/scripts/seedMonitoringData.js` | Realistic fake data for development. |

---

## The one rule: no code changes between environments

Promoting this feature from development to production is a change of variable
**values**, never a change of code.

Three things follow from that, and all three are load-bearing:

1. **No `NODE_ENV === 'production'` branches.** There are none in this feature,
   and there should never be. A branch means the deployed behaviour is a code
   path that cannot be exercised anywhere else, so the first time it runs for
   real is in production. The same code path runs everywhere; only the numbers
   differ.

2. **One config module.** `monitoring.config.ts` is the only file that reads the
   environment. Anything else reading `process.env` directly would be a second
   source of truth that this document cannot describe.

3. **No provider SDK.** Metrics come from `process.memoryUsage()`,
   `process.cpuUsage()`, the `pg` pool and the Socket.IO server. Moving host
   changes nothing here.

### Adding a new setting

Add it to `monitoring.config.ts` with a documented default, add a row to
`.env.example`, and add a row to the table below. Do not read it anywhere else.

---

## Environment variables

Every variable is optional. The defaults are chosen so that a developer who
sets none of them gets full capture and short retention, which is what you want
locally.

| Variable | Default | What it controls | Typical production value |
| --- | --- | --- | --- |
| `MONITORING_ENABLED` | `true` | Master switch for collection. The admin API still serves history when off. | `true` |
| `LOG_SAMPLE_RATE` | `1.0` | Fraction of **successful** requests recorded (0–1). Errors and slow requests always bypass this. | `0.2` |
| `SLOW_REQUEST_MS` | `1000` | At or above this duration a request is always recorded, whatever the sample rate. | `1000` |
| `METRICS_INTERVAL_MS` | `15000` | How often a system snapshot is taken. | `30000` |
| `MONITORING_FLUSH_INTERVAL_MS` | `5000` | How often buffered rows are written. | `5000` |
| `MONITORING_FLUSH_BATCH_SIZE` | `50` | Buffered rows that trigger an early flush. | `100` |
| `MONITORING_MAX_BUFFERED_ROWS` | `5000` | Hard cap on the buffer. Overflow drops oldest-first. | `5000` |
| `LOG_RETENTION_DAYS` | `14` | Rows older than this are deleted. | `30` |
| `LOG_RETENTION_INTERVAL_MS` | `21600000` (6h) | How often the retention sweep runs. | `21600000` |
| `LOG_STACK_TRACES` | `false` | Whether stack traces are stored on error rows. | `false` |
| `REDACT_FIELDS` | *(empty)* | Extra field names to redact, comma-separated. **Merged with** the built-in list; it cannot shrink it. | as needed |
| `MONITORING_IGNORED_ROUTES` | `/admin/monitoring,/health,/metrics,/favicon.ico` | Route prefixes never recorded. | default |
| `MONITORING_POLLING_INTERVAL_MS` | `15000` | Dashboard refresh cadence, served to the client. | `30000` |
| `MONITORING_PAGE_SIZE` | `50` | Rows per page in the admin log tables. | `50` |
| `MONITORING_RATE_LIMIT_POINTS` | `120` | Monitoring API requests allowed per window, per admin. | `120` |
| `MONITORING_RATE_LIMIT_WINDOW_SEC` | `60` | The window for the above. | `60` |
| `MONITORING_ERROR_RATE_WARNING` | `5` | Error-rate % above which the dashboard shows "Degraded". | `2` |
| `MONITORING_LATENCY_WARNING_MS` | `800` | Avg latency above which the dashboard shows "Degraded". | `500` |
| `MONITORING_ENVIRONMENT_LABEL` | *(empty)* | Free-text label on the status card. **Display only** — never used for a decision. | `production` |

### What actually differs in production

Only these, and only as values:

```bash
LOG_SAMPLE_RATE=0.2                 # full capture is too many rows at real traffic
METRICS_INTERVAL_MS=30000           # half as many snapshots
LOG_RETENTION_DAYS=30               # keep longer
MONITORING_POLLING_INTERVAL_MS=30000
MONITORING_ERROR_RATE_WARNING=2     # tighter thresholds
MONITORING_LATENCY_WARNING_MS=500
MONITORING_ENVIRONMENT_LABEL=production
```

`MONITORING_ENVIRONMENT_LABEL` is a string printed on a card. It is deliberately
never read for a decision, so it cannot quietly become an environment branch.

---

## What is never recorded

Enforced in `redactor.ts` and by the shape of the schema — there is no column
for a header, a cookie or a body, so there is nowhere for one to go.

Never stored:

- `Authorization` headers, cookies, JWTs, session ids, CSRF tokens
- passwords, OTPs, API keys, any token
- request or response bodies, in whole or in part
- private message contents, uploaded file contents
- query strings
- any PII beyond `userId`

`REDACT_FIELDS` is **merged with** a hardcoded minimum rather than replacing it.
A deployment can add to the denylist; it cannot shrink it by setting a variable.
Removing a protection requires editing code, which is the correct asymmetry.

Error messages are additionally scrubbed for credential-shaped substrings
(bearer tokens, JWTs, `key=value` secrets, connection strings with passwords,
and bare email addresses) before storage, because a driver error routinely
quotes the input that caused it.

Route paths are recorded as **patterns**, never concrete URLs:
`/api/messages/:id`, never `/api/messages/8231`. That keeps per-endpoint
aggregation meaningful, and identifiers out of the table.

---

## Performance

Logging never blocks a response:

- `MonitoringWriterService` buffers in memory and flushes on a timer or once a
  batch fills. `record*()` pushes onto an array and returns.
- The buffer is **capped**. If the database is unreachable, the oldest rows are
  dropped rather than the buffer growing until the process is killed. A gap in
  telemetry is a far better outcome than an outage caused by the monitoring.
- A failed flush is logged once and its rows discarded, not retried forever.
  Retrying into a struggling database adds load to the thing that is failing.
- Dropped-row counts surface on the dashboard's "Write buffer" gauge, so a
  silent gap is visible rather than invisible.

---

## Security

- Every route sits behind `AdminJwtGuard` (session + CSRF), applied at the
  controller so a route added later cannot be left unguarded by omission.
- A per-admin rate limit sits on top. These are the most expensive queries in
  the application and the dashboard polls them; a tab left open overnight must
  not keep a 7-day aggregation running back to back.
- The API is read-only. There is no endpoint that mutates monitoring data.
- Stack traces, when enabled, are admin-only on read.

---

## Development

Seed realistic data so the dashboard has something to show before real traffic
exists:

```bash
cd backend
node scripts/seedMonitoringData.js --hours 24
```

The generated data is deliberately uneven — a daily traffic curve, a genuinely
slow endpoint, and one burst of errors — because a dashboard tested against
flat uniform data hides exactly the problems it exists to reveal.

Remove seeded rows without touching real ones:

```bash
node scripts/seedMonitoringData.js --clear
```

---

## Adding a new metric

1. Add the column to the relevant model in `backend/prisma/schema.prisma` and
   write a migration.
2. Populate it in the collector that owns it (`system-metrics.collector.ts` for
   process/DB values, the middleware for per-request values).
3. If it needs a setting, add it to `monitoring.config.ts`, `.env.example` and
   the table above.
4. Return it from `admin-monitoring.service.ts`.
5. Render it in `MonitoringPage.tsx`.

If the new value could contain user input, route it through `redactText()` and
add its field name to `ALWAYS_REDACTED` in `monitoring.config.ts`.
