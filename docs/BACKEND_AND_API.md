# Backend and API

The NestJS API in `backend/`: how it is organised, the coding rules CI
enforces, background work, realtime, uploads, email, rate limiting, and the
documented API contracts.

Related: [ARCHITECTURE.md](ARCHITECTURE.md) (system overview),
[DATABASE.md](DATABASE.md), [SECURITY.md](SECURITY.md) (guards, sessions,
CSRF), [FEATURES_AND_FLOWS.md](FEATURES_AND_FLOWS.md) (feature behaviour),
[OBSERVABILITY.md](OBSERVABILITY.md#api) (Sentry on the API).

---

## 1. Layout

NestJS 11 on Node ≥ 22, one module per domain under `backend/src/`:

```
academics  account-deletion  account-email  account-security  activities
admin  app-version  auth  campus-affiliation  campus-events  communities
confessions  email  events  health  instant-match  legal  link-preview
mentions  messages  moderation  notifications  otp  posts  presence  push
ranking  realtime  redis  search  share  supabase  support  suspension
uploads  users  verification
common/         guards, decorators, interceptors, rate limiting, campus gating,
                verification gating, utils, typed test doubles
config/         env.ts (the only reader of process.env), *.config.ts,
                isolation.guard.ts
observability/  Sentry trace sampler, background tracing, scrubbing
prisma/         PrismaService, connection retry
instrument.ts   Sentry bootstrap, imported first by main.ts
```

Other directories: `backend/prisma/` (schema + migrations),
`backend/supabase-templates/` (rendered Auth email templates per environment),
`backend/scripts/` (TypeScript maintenance scripts).

### Configuration

`src/config/env.ts` is the only file that reads `process.env`; every other file
imports the typed `config` object. Validation runs once at import, so a bad
environment fails at boot with one message listing every problem. Feature
configs (`app.config.ts`, `auth.config.ts`, `push.config.ts`,
`rate-limit.config.ts`, …) build on it. See
[INFRASTRUCTURE.md](INFRASTRUCTURE.md#3-configuration-and-environment-files)
for file loading and the per-environment variable lists.

---

## 2. Type safety and lint (blocking, at zero)

`npm run lint` in `backend/` lints every source file, including the email
templates and `scripts/`, and CI runs it with `--max-warnings 0`. The backend
is at zero errors and zero warnings, with **no suppressions ledger**, so a new
`any` or a new unawaited promise cannot be merged. Never add inline
`eslint-disable` comments, never create a suppressions file, and never relax a
rule to make code pass — fix the code, or raise it for a decision.

The backlog this replaced was 8,000 violations, and 89% of them were the
downstream spread of a few hundred `any`s. One `any` switches off the checks
that catch a misspelt column, an undefined user id, or a Prisma filter that
silently matches everything. The conventions that keep it at zero:

- **No `any`, and no `as any`.** A cast to reach a missing field hides a real
  mismatch: fix the query's `select`/`include`, or take `unknown` and narrow it
  with a guard.
- **Type the sources, not the symptoms.** `@CurrentUser() user: AuthenticatedUser`;
  `ctx.switchToHttp().getRequest<AuthenticatedRequest>()`;
  `Prisma.XWhereInput` for a `where` built up conditionally;
  `$queryRaw<Row[]>`; `Prisma.TransactionClient` for a transaction helper.
  Declare return types on service methods other modules call, so an `any`
  cannot leak out through inference.
- **Untrusted input is `unknown` until validated.** HTTP bodies use a
  class-validator DTO (an `any` body skips the global `ValidationPipe`, which
  runs with `whitelist` + `forbidNonWhitelisted`). Socket payloads take
  `data: unknown` and go through `parseSocketPayload`. `JSON.parse`,
  `jwt.verify` and remote responses are narrowed before use.
- **Catch variables are `unknown`** (`useUnknownInCatchVariables`). Use
  `errorMessage()` from `common/utils/error.util`, or `instanceof` checks.
- **Class fields are definitely assigned** (`strictPropertyInitialization`):
  `field!: T` for a required DTO field the pipe fills, `field?: T` for an
  `@IsOptional()` one, `T | undefined` for one that may stay unset.
- **Promises are awaited, or `void` with a comment saying why** they are
  deliberately fire-and-forget.
- **Tests are typed the same way.** Build fakes with `stub<T>()` from
  `src/common/testing/stub.ts` (it checks member names against the real class),
  give `jest.fn` its signature, reuse the shared doubles under
  `src/**/testing/`, and reach private members as `service['member']`, not
  `(service as any)`. **Never change what a fake returns to satisfy a type** —
  wrap it in `jest.fn(impl)` instead; a different return value is a different
  test.
- **Scripts are TypeScript** (`npx ts-node scripts/<name>.ts`) and are linted
  like the app. Anything that goes through `src/config` is pointed at
  development. To check a script without touching anything, set its variables
  to empty strings explicitly (dotenv never overrides a set variable), and
  never pass `--apply` as a test.
- `Math.random` is never used for a token, id, secret or lock value.

Before opening a PR, run in `backend/`:

```bash
npm run lint && npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.tooling.json && npx jest
```

---

## 3. Background work (BullMQ on Redis)

| Queue | Work |
|---|---|
| `email` | Transactional mail through Resend. |
| `notifications` | Notification fan-out (e.g. `follow-notification`). |
| `push` | Web push and FCM delivery ([FEATURES_AND_FLOWS.md](FEATURES_AND_FLOWS.md#2-push-notifications)). |
| `account-deletion` | Scheduled account purge. |
| `instant-match` | Instant Match lifecycle. |
| `ranking` | Ranking/affinity computation for the For You feed. |

- Queue processors extend `DrainingWorkerHost`, which closes the worker in
  `beforeApplicationShutdown`, before Prisma disconnects.
- Jobs carry ids, not content, and are re-checked at execution time where
  authorization matters (push).
- Timers (lifecycle sweeps, revoked-session sweep, Instant Match expiry and
  chat cleanup, retention sweeps, error-log flushes) run in-process. Each
  background unit is wrapped in `traceBackground` so its queries are traced
  ([OBSERVABILITY.md](OBSERVABILITY.md#api)); new background work must do the
  same.
- Redis is not a cache and must stay `noeviction`
  ([INFRASTRUCTURE.md](INFRASTRUCTURE.md#redis)).

## 4. Realtime (Socket.IO)

`realtime/realtime.gateway.ts` serves presence, messaging events, typing,
receipts, Instant Match and post/community rooms.

- Sockets bypass `JwtGuard`, so the gateway authenticates the handshake itself
  and performs a database lifecycle check. The installed app sends the access
  token **and** `sessionId` in the handshake payload (a WebView never stores
  the session cookie); the gateway runs the same ownership/liveness lookup it
  runs for the cookie. The token is taken at every connection
  (`token || getAccessToken()`), because on the app it lives in secure storage.
- Connection rate limiting runs per IP **before** token verification and per
  user after it ([Realtime limits](#realtime)).
- Room joins are authorized: `post:join` and `community:join_room` apply the
  same denial set as the REST reads (the post room carries comment bodies);
  conversation rooms verify participation.
- Socket payloads are `unknown` and parsed by `parseSocketPayload`.
- On affiliation change the server emits `user:campus_changed`
  `{ campusAffiliation }` to the user.
- Clients connect polling-first (`['polling','websocket']`) on purpose:
  intercepting campus proxies hang WebSocket attempts for the full timeout.
- One emit sent immediately on connect can still get a single transient
  `Unauthenticated` (the gateway authenticates after it acks the namespace);
  the client recovers on its own.

## 5. Uploads and media

- Object storage is Cloudflare R2 via the AWS SDK v3 S3 client. Public media
  bucket plus a private bucket for `verification/` keys and conversation media
  (`bucketFor()`); see [INFRASTRUCTURE.md](INFRASTRUCTURE.md#storage-r2).
- Clients upload **directly to R2 with a presigned PUT**; the presign returns
  the headers it signed (`Cache-Control` differs for private objects). After
  one network/CORS failure the client uses the backend pass-through for the
  rest of the session; the pass-through keeps a thumbnail's derived key.
- Per-file limits (`uploads/uploads.constants.ts`, mirrored by
  `frontend/src/shared/constants/mediaLimits.js`), each file measured on its
  own: messages 15 MB video / 5 MB image; posts 25 MB video / 5 MB image; voice
  notes 15 MB (five-minute recording cap in the client); covered images 10 MB;
  everything else 50 MB; college logos 2 MB. R2's signed `Content-Length` is
  verified.
- The pipeline converts images to WebP and uploads a `_thumb.webp` variant
  (1080 px for post media, 160 px for avatars). A variant may only be written
  by the owner of its original, and only over a variant row they own.
- `/api/media/<key>` serves/redirects media and authorizes conversation media
  by **participation** (not just ownership); private media uses signed URLs.
  `/api/media/<key>_thumb.webp` falls back to the original when no thumbnail
  exists. SVG is never accepted for logos: `/api/media/*` serves from the API
  origin with no SVG sanitizer, so an SVG would be stored XSS.
- `Media` rows are registered at presign time, so a row does not prove the
  object exists.
- Chat media uploaded before commit `bc60f39` is still on the public CDN
  (see [SECURITY.md](SECURITY.md#11-open-security-items)).

## 6. Email

- Application mail is queued on `email` and sent by `EmailProcessor`:
  **Resend** API first, the **Brevo** SMTP relay as a selective failover, Mailpit
  locally. Supabase Auth mail is a separate path that Supabase sends through
  Brevo. Providers, variables, the failover classification and usage counting:
  [INFRASTRUCTURE.md](INFRASTRUCTURE.md#email).
- Templates are React Email components under `src/email/templates/` rendered to
  HTML (e.g. `email-address-otp.tsx`, `signin-email-changed.tsx`); all share
  `BaseLayout.tsx`. Security mail uses `EMAIL_SECURITY_FROM`.
- `/dev/email/*` preview routes exist only when `FEATURE_DEV_ENDPOINTS` is on
  (never in production) and need `DEV_ENDPOINT_TOKEN` or loopback.
  `npm run email:test-all` sends every template to Mailpit.
- `EmailUsageService` counts sends per provider per day; it does not refuse
  sends (see [Not implemented yet](#not-implemented-yet)).

## 7. Idempotent creates

`IdempotencyInterceptor` makes a write that carries an `Idempotency-Key` header
happen at most once. It applies only to routes marked `@Idempotent()`: creating a post and a
comment (`posts.controller`), starting a conversation (`messages.controller`),
creating a group chat, a community or an activity, sending an activity
discussion message, and creating a support request (`POST requests` and
`POST requests/mine`). Without it, a client failover that re-sent a POST whose response
was lost, or a user tapping "Post" again after a timeout, created duplicates.

- Keys are scoped to the caller (user id, or IP when signed out) and to method
  + path. The same key with a different body → 422.
- A repeat while the first is running waits up to 10 s then replays, or
  answers 409. A failed write releases its key; a successful one is replayable
  for 1 hour. Results over 64 KB keep only a marker, and a repeat gets 409
  `IDEMPOTENCY_ALREADY_PROCESSED` rather than running again. Claims expire 60 s
  after a crashed process stops refreshing them.
- Without the header, or without Redis, requests behave exactly as before, so
  installed apps that predate it are unaffected.
- The web client sends keys only when built with `VITE_IDEMPOTENCY_KEYS=true`.
  Turn that on only once the API that accepts the header (CORS
  `allowedHeaders` in `main.ts`) is deployed to every environment the build
  talks to; a preflight that rejects a header fails the whole request.

## 8. Error handling

`HttpExceptionFilter` (global) logs, records to the error log
(`ErrorLog`, viewed in the admin Error Logs page), reports 5xx to Sentry and
answers the client with a safe body (e.g. `"Internal server error"`). Stacks
stay server-side. 4xx are expected outcomes and are not reported.

Two in-app capture tables back the admin analytics pages (configuration in
`observability.config.ts`):

| Capture | Defaults | Variables |
|---|---|---|
| Error log (`ErrorLog`) | on; 7-day retention; ≤ 120/min; client (4xx) errors **off** | `ERROR_LOG_CAPTURE_ENABLED`, `ERROR_LOG_RETENTION_DAYS`, `ERROR_LOG_MAX_PER_MINUTE`, `ERROR_LOG_CAPTURE_CLIENT_ERRORS`, `ERROR_LOG_IGNORED_PREFIXES` |
| Slow requests | on; threshold 500 ms; 7-day retention; ≤ 120/min; ignores `/admin/analytics,/health,/metrics,/favicon.ico` (setting the list **replaces** the default) | `SLOW_REQUEST_CAPTURE_ENABLED`, `SLOW_REQUEST_THRESHOLD_MS`, `SLOW_REQUEST_RETENTION_DAYS`, `SLOW_REQUEST_MAX_PER_MINUTE`, `SLOW_REQUEST_IGNORED_PREFIXES` |

Slow database queries are logged above `DB_SLOW_QUERY_MS` (default 500);
`DB_CONNECTION_RETRIES` defaults to 3.

### Feature flags and logging

| Variable | Default | Effect |
|---|---|---|
| `FEATURE_FEED_RANKING` | `true` | Ranked "For You" home feed; `false` falls back to the chronological feed with no client change (the escape hatch if ranking misbehaves). |
| `FEATURE_DEV_ENDPOINTS` | on outside production | `/dev/*` routes; forced off in production. |
| `FEATURE_DEBUG_TOOLS` | on in development | Debug surfaces; forced off in production. |
| `FEATURE_EXPERIMENTAL` | `false` | Unreleased functionality per environment. |
| `LOG_LEVEL` | `info` in production, `debug` elsewhere | pino level. |
| `LOG_PRETTY` | off in production | Keep JSON logs in production (Log Analytics parses them). |
| `LOG_QUERIES` | on in development | Log every query, not only slow ones. |

Code asks `config.features.*`, never `NODE_ENV`. The old
`FEATURE_RELAXED_RATE_LIMITS` flag was removed (see rate limiting).

---

## 9. Rate limiting

How abuse prevention works, what is deployed, what is deliberately not built
yet, and what will bite as the user base grows. The limit **values** below
were re-read from `src/config/rate-limit.config.ts` at `POLICY_VERSION = 12`;
the trust-proxy measurements were last verified against production on
2026-09-05 (policy v7).

### Where everything lives

| File | Role |
| --- | --- |
| `src/config/rate-limit.config.ts` | **The single source of truth.** Every limit, as a literal. Also the trust-proxy hop count, key namespace and `POLICY_VERSION`. |
| `src/common/rate-limit/rate-limit.service.ts` | The only thing that talks to `rate-limiter-flexible`. Owns identifiers, Redis, fallbacks, logging. |
| `src/common/rate-limit/client-ip.util.ts` | Resolves the client address. **Nothing else may read `x-forwarded-for`.** |
| `src/common/rate-limit/rate-limit.decorator.ts` | `@RateLimit('policy.name')` |
| `src/common/rate-limit/rate-limit-policy.guard.ts` | Enforces whatever a route declares |
| `src/common/rate-limit/rate-limit.response.ts` | The 429 shape and headers |
| `src/common/guards/ratelimit.guard.ts` | The global tier, applied to every route |
| `src/messages/core/message-limits.ts` | Messaging limits, shared by every send implementation |

Limit **values are not environment variables**, deliberately. A limit that can
be weakened by an env var gets weakened during an incident, and it makes "the
same limits everywhere" unenforceable. The environment supplies only
infrastructure: Redis URL, key prefix, hashing secret, proxy hop count.

Changing a number is a reviewed commit **and a `POLICY_VERSION` bump** — the
version prints in the startup banner and on every rejection, so a shift in the
metrics can be traced to a revision, and a deploy can be confirmed from logs.
Bump it for anything that changes limit *behaviour*, not just the numbers —
identifier resolution counts.

### Adding a limit

Two lines, in most cases:

```ts
// 1. config/rate-limit.config.ts
'post.create.user': {
  points: 8, duration: 600, dimension: 'user',
  onRedisFailure: 'closed',
  message: "You've posted a lot recently. Try again shortly.",
},
```

```ts
// 2. the controller — auth guard FIRST, so the user is resolved
@UseGuards(JwtGuard, RateLimitPolicyGuard)
@RateLimit('post.create.user')
```

Multiple policies compose: `@RateLimit('a', 'b')` consumes both, and either can
reject. Prefer that over writing a bespoke guard — four near-identical guard
classes is how this codebase looked before.

**`dimension: 'resource'` cannot be enforced by the guard** (it has no resource
id before the controller runs). Enforce it in the service, *after* the
ownership check, so a 429 can never confirm a resource exists. See
`assertSendWithinRateLimit`.

### Current limits

Format: points / window. "block" = the key is blocked for that long after the
limit is reached.

#### Global tiers — every route

| Policy | Limit | Key |
| --- | --- | --- |
| `global.user` | 300/min | user |
| `global.ip` | 120/min | IP |
| `global.ip.burst` | 100/10 s | IP |

**The two tiers are mutually exclusive.** Once a request carries a verified JWT
the user tier governs and the IP tier is skipped entirely. This is not an
optimisation — a campus NAT gateway presents thousands of students as one
address, and applying the IP tier to authenticated traffic would take a whole
campus down at peak.

`/health` is exempt. A rate-limited health check causes the outage it reports.

#### Authentication and account

| Policy | Limit | Key |
| --- | --- | --- |
| `auth.login.ip` | 10/5 min, then blocked 5 min | IP |
| `auth.login.account` | 6/15 min, then blocked 15 min | account |
| `auth.probe.ip` | 20/min | IP |
| `auth.probe.daily` | 200/day | IP |
| `auth.verifypassword.user` | 5/15 min, then blocked 15 min | user |
| `auth.passwordreset.account` | 3/hour | account |
| `auth.passwordreset.finalize.ip` | 20/hour | IP |
| `auth.signup.ip` | 10/hour | IP |
| `auth.signup.account` | 5/hour | account |
| `auth.otp.user` | 5/15 min | user |
| `auth.otp.cooldown` | 1/60 s | user |
| `auth.otp.ip` | 20/day | IP |
| `auth.emailtrigger.user` | 6/hour | user |
| `auth.collegerequest.ip` | 5/day | IP |
| `auth.collegerequest.email` | 3/day | account |
| `auth.session.adopt` | 10/hour | user |
| `auth.session.refresh` | 60/5 min, then blocked 15 min | IP |
| `verification.capture.user` | 20/hour | user |
| `admin.login.ip` | 8/5 min, then blocked 30 min | IP |
| `admin.login.account` | 5/15 min, then blocked 30 min | account |
| `admin.refresh.ip` | 30/5 min, then blocked 15 min | IP |

**Login has two dimensions and they catch different attacks.** The IP budget
stops one host working through many accounts (password spraying). It does
nothing about a botnet spread over thousands of addresses each making two
attempts against *one* account, because no single IP ever reaches its limit.
That is what the account dimension is for. Only **failed** attempts spend the
account budget, so nobody is locked out by their own successful logins.

**The daily probe cap is the control that matters.** 20/min sounds strict, but
sustained it is ~28,800 probes a day — enough to walk the whole user table
without ever tripping the minute window.

**The 60-second OTP cooldown is pinned by Supabase**, which enforces its own
60 s floor. Going below it would replace our clear message with an opaque
upstream 429. `auth.verifypassword.user` fails closed without Redis.

#### Messaging

Keyed on the **operation**, never the path. `/api/messages`, `/api/dm`,
`/api/group-chats` and the `message:send` socket event are four entry points
onto one action; a per-path limit is bypassed by rotating between them.

| Policy | Limit | Key |
| --- | --- | --- |
| `msg.send.user` | 60/min | user |
| `msg.send.conversation` | 40/min | user + conversation (resource) |
| `msg.forward.user` | 30/min | user |
| `msg.startconv.user` | 25/hour | user |
| `msg.creategroup.user` | 8/hour | user |
| `msg.invitelink.user` | 20/hour | user (only when a new invite link is made) |

`MAX_FORWARD_TARGETS = 15` caps fan-out per forward, and **forwarding costs one
point per destination** — otherwise one request reaches fifty conversations for
the price of one. The cap and the budget must stay in step: if the cap ever
exceeds the budget, every maximum-size forward is refused outright and the
feature looks broken rather than limited.

New-conversation limits are charged **only for genuine first contact**.
`startDM` and `startConversation` return the *existing* conversation when there
is one — that is how the UI opens an old thread — so the charge sits past that
branch, beside the verification gate placed there for the same reason.

#### Realtime

| Policy | Limit | Key | On breach |
| --- | --- | --- | --- |
| `socket.connect.ip` | 40/min | IP | refuse |
| `socket.connect.user` | 10/min | user | refuse |
| `socket.catchup.user` | 10/min | user | error ack |
| `socket.roomjoin.user` | 60/min | user | error ack |
| typing (in-process) | 15/10 s | user + conversation | **silent drop** |
| heartbeat / ping (in-process) | 6/min | socket | **silent drop** |

Connection limiting is two tiers and **the order is load-bearing**. The per-IP
tier runs *before* token verification, because `validateToken` falls back to a
remote Supabase call when local verification fails — so a garbage-token flood
would otherwise become one outbound Supabase request per attempt, turning our
own handshake into an amplifier against our auth provider. It stays coarse (40)
because a campus shares one address. The per-user tier runs after and can be
tight (10) because it has no shared-address problem.

Ephemeral events are dropped **silently** and never error. A lost typing
indicator is invisible; one that raises an error toast is a bug.

#### Instant Match

| Policy | Limit | Key |
| --- | --- | --- |
| `im.join.user` | 10/min | user |
| `im.join.hourly.user` | 40/hour | user |
| `im.join.ip` | 25/hour | IP |
| `im.respond.user` | 30/min | user |
| `im.request.user` | 6/min | user |
| `im.queuesync.user` | 20/min | user |
| `im.queuelist.user` | 40/min | user |

Previously counted in one process's memory, so the real ceiling was multiplied
by replica count and reset on every deploy.

#### Content, media, push and support

| Policy | Limit | Key |
| --- | --- | --- |
| `content.post.create` | 15/10 min | user |
| `content.comment.create` | 60/10 min | user |
| `community.create` | 5/hour | user |
| `confession.handle.check` | 60/min | user |
| `confession.profile.create` | 10/hour | user |
| `confession.create` | 5/10 min | user |
| `confession.create.daily` | 20/day | user |
| `confession.relate` | 120/10 min | user |
| `confession.sync` | 60/10 min | user |
| `media.presigned` | 120/5 min | user |
| `push.register` | 30/hour | user |
| `push.preferences` | 60/hour | user |
| `support.request.ip` | 5/hour | IP |
| `support.request.email` | 3/hour | account |
| `support.attachment.ip` | 30/hour | IP |

The two support request policies are both consumed even when the first
rejects, so the cheaper key cannot be probed by someone who knows the expensive
one will refuse.

### Identifiers, and the trust-proxy story

| Dimension | Source | Notes |
| --- | --- | --- |
| `user` | verified JWT (or admin cookie) | unforgeable |
| `ip` | `req.ip` **only** | hashed before use; IPv6 collapsed to /64 |
| `account` | submitted email/identifier | normalised, hashed; always paired with an IP dimension |
| `resource` | server-resolved id | enforced in the service, after authorization |

IPs and emails are HMAC-hashed before they become Redis keys or log fields.
IPv6 is collapsed to its /64 because a single customer allocation is 2^64
addresses — per-address keying would hand an IPv6 client unlimited buckets.

#### `TRUST_PROXY_HOPS`

**Production is 2. This was measured, not reasoned about, and reasoning about
it was wrong twice.**

`api.meetifyy.app` is **proxied through Cloudflare** and the origin accepts
Cloudflare's addresses only ([INFRASTRUCTURE.md](INFRASTRUCTURE.md#origin-protection-production-api)).
Re-measured on 2026-11-12 with `hops=2`: requests through Cloudflare key on the
real client, one bucket counting down, and a forged `X-Forwarded-For` does not
move it. (The measurements below were taken when the host was DNS-only, where
Azure Container Apps added **two** entries: the client, then its own internal
envoy hop, whose address **rotates per TCP connection**.)

With `hops=1` Express took the rightmost entry — the rotating envoy address —
so **60 requests from one machine produced 16 different buckets**, and every
per-IP limit was roughly 16× weaker than configured. Login brute-force
protection was effectively absent.

This was hard to spot because it was *not spoofable*. A forged-header test
appeared to pass: the header genuinely was ignored. But the value being
resolved to was infrastructure, not the caller. **"Not spoofable" and "correct"
are different properties, and only the first was being tested.**

Verified at `hops=2` against production:

- 60 requests over 60 separate connections → **one** bucket, counting down
  monotonically, enforcing at the limit
- forged `X-Forwarded-For`, including multi-entry, does not move the bucket

**How to re-verify** (after any infrastructure change):

```bash
# Should count down monotonically — each value exactly once
for i in $(seq 1 60); do
  curl -s -D- -o /dev/null https://api.meetifyy.app/api/academics/colleges \
    | grep -oP 'remaining=\K[0-9]+'
done | sort -n | uniq -c
```

Many values appearing once = correct. Values repeating = multiple buckets =
hop count wrong.

> **An earlier note here said this must become 3 once Cloudflare proxies
> `api`. That was reasoning, and the measurement disagrees:** with the proxy on
> and `hops=2`, direct and proxied requests from one machine shared one bucket.
> What the same test did show is that the *direct* Azure hostname honoured a
> forged `X-Forwarded-For` (a fresh bucket per forged value) — which is why the
> origin is now closed to everything but Cloudflare. Re-run the check above
> after any change to the path, and run it on dev before proxying `dev-api`.

#### Known gap: the Vercel failover path

`vercel.json` rewrites `/_api/*` to the same backend, used when the direct host
is unreachable. That path has one more hop, so traffic arriving through it
resolves to Vercel's egress address and shares one bucket. This is a stable,
unspoofable wrong value; it only applies while the direct API is down; and
authenticated users are unaffected because they are counted per user. Revisit
if that path ever carries normal traffic.

### Failure behaviour

Redis is resolved **per call**, never captured at construction. An earlier
version stored the client in a guard constructor; ioredis connects lazily, so a
process that started before Redis was ready had rate limiting silently disabled
for its entire lifetime.

| Class | On Redis failure |
| --- | --- |
| auth, OTP, messaging, uploads (`onRedisFailure: 'closed'`) | fall back to a per-instance in-memory limiter and **keep enforcing** |
| reads, feed, search | allow |

Rejection is distinguished from store failure **by shape**, not `instanceof
Error` — otherwise a bug inside the limiter is indistinguishable from an outage
and everything fails open.

Every fallback logs `ratelimit.degraded` at ERROR. **That line should never
appear.** If it does, limits are not shared across instances.

### Observability

Every rejection emits:

```json
{"policy":"msg.send.conversation","dimension":"resource","subject":"f5ad9a281451",
 "limit":40,"window":60,"resetSeconds":58,"mode":"enforce","degraded":false,
 "policyVersion":7,"env":"production"}
```

`subject` is a short one-way hash — never a user id, address or email. It
exists because **a rejection count alone cannot tell you whether a limit is too
tight**. Many people each hitting it once, and one person hitting it fifty
times, look identical in a total and opposite in a breakdown. The KQL query
and how to read its `perPerson` ratio are in
[OBSERVABILITY.md](OBSERVABILITY.md#rate-limit-rejections).

### Environments

Identical values everywhere — local, dev, staging, production, CI. The
`FEATURE_RELAXED_RATE_LIMITS` flag was removed; it defaulted to on outside
production, which is why the defects above went unnoticed for so long.

`RATE_LIMIT_MODE=shadow` evaluates and logs every policy without rejecting
anything. Use it to measure a new limit against real traffic before enforcing.
**Refused in production**, so it cannot become an accidental bypass.

Per-environment: `REDIS_URL`, `RATE_LIMIT_KEY_PREFIX`, `RATE_LIMIT_HASH_SECRET`,
`TRUST_PROXY_HOPS`, log destination. Nothing else.

### Not implemented yet

Ordered by what would be done next. Status re-checked against the policy list
above.

| Gap | Why it matters |
| --- | --- |
| **Content creation limits — partly done.** Posts, comments, communities and confessions now have limits; **likes and follows do not**, and there is no daily quota for posts/comments. | Nothing bounds a user liking/following continuously. The specified shape is a short window *plus* a daily quota, because slow-drip spam passes every per-minute limit. |
| **Report/moderation limits, esp. per-target** | Report-bombing one profile is both harassment and a moderation-queue DoS. A per-user limit alone permits it. |
| **Media upload concurrency** | Per-file size is enforced and presigns are counted (`media.presigned`); *concurrency* is not. `sharp` is CPU-bound, and parallel large images starve the event loop. |
| **Search / directory daily quotas** | The campus directory is the obvious scraping target. A per-minute limit still permits full extraction, just slowly. |
| **Concurrent socket connection cap per user** | We limit how *fast* you connect, not how *many* at once. Needs cross-replica connection state in Redis with cleanup on disconnect — and if a process crashes, stale entries lock that user out. Deliberately deferred rather than shipped fragile. |
| **Email daily ceiling enforcement** | `EmailUsageService` counts sends per provider per day but never refuses. Should reserve headroom so password resets survive a spike. |
| **Edge/WAF layer — partly done (2026-11-12).** Cloudflare drops scanner paths and auth floods on production ([INFRASTRUCTURE.md](INFRASTRUCTURE.md#cloudflare-edge-configuration)); the Free plan allows one rate-limit rule, and dev is not behind the edge. | Every request the app rejects still costs a TLS handshake and a Redis round-trip. |
| **Dashboards + alerts** | The KQL is manual. Nothing pages anyone today. |

### What will bite as the user base grows

**`msg.send.conversation` (40/min) is the most likely false positive.** A
lively group chat with several people talking is the realistic case. It is
also the only limit set without production data behind it. Watch its
`perPerson` ratio first.

**Campus NAT is the structural risk.** Thousands of students share one public
address. Every IP-keyed limit is shared by all of them. Today this is contained
because the IP tier only applies to *unauthenticated* traffic and
`socket.connect.ip` is deliberately loose — but as a campus grows, anonymous
traffic (help centre, landing pages, media) will approach 120/min from a single
address legitimately. **Watch `global.ip` rejections grouped by subject: many
distinct subjects behind one campus is invisible in the data, so a rising
`global.ip` rejection rate with a *low* `perPerson` is the signal.** The fix is
not simply raising it — it is moving more traffic behind authentication, or
adding a CDN in front of the public read endpoints.

**Supabase ceilings are platform-wide, not per-user.** Because auth is proxied
through this backend, Supabase sees only our egress address, so its documented
defaults (~1800 token refreshes/hour, ~360 verifies/hour, 30 OTP emails/hour)
are shared by *everyone*. **The OTP budget is the one that will hurt first** —
30 per hour across the entire platform. Our own limits sit below these, but at
a few thousand active users this becomes a hard capacity ceiling and needs its
own monitoring. It is an upstream dependency, not just a security control.

**Redis is in the request path of every call.** Each request costs at least
one round-trip; composite policies cost two or three. Redis runs as a single
Container App replica with 0.25 CPU / 0.5 GB. **This is a single point of
failure for the whole API's latency.** Watch Redis command latency p99 and
memory. Key cardinality is bounded (active identifiers × policies) and every
key carries a TTL, so unbounded growth is not a risk — capacity and
availability are.

**Redis reconnect behaviour is a live concern.** `redis.service.ts` has
`retryStrategy: times > 5 ? null : ...` (still true in the current code) —
returning `null` means **stop retrying permanently**, so a client that fails
six reconnects is dead for the life of the process. Production logs show the
subscriber reconnecting roughly every five minutes (Azure kills idle internal
TCP connections), so the retry path is exercised constantly. If it ever
exhausts, rate limiting silently degrades to per-instance counting until a
restart. `ratelimit.degraded` would fire, but it will not self-heal. **This is
unfixed and is the single most likely cause of a future "limits stopped
working" incident.**

**Scaling past one replica changes assumptions.** `maxReplicas` is currently 1.
Redis-backed limits are already correct across instances, but the
*in-process* pieces are not, by design: ephemeral socket throttles and the
insurance limiter both count per process. At N replicas the effective
ephemeral ceiling is N×. That is acceptable for typing indicators; it would
not be for anything durable.

**The `/api/messages` alias family should be deprecated.** Three controllers
implementing one feature is the root cause of the alias bypass; the shared
budget is a mitigation, not a fix. Any *new* messaging operation must be added
to `message-limits.ts`, not to a controller, or the bypass reopens.

### Things to be careful of

- **Never read `x-forwarded-for` directly.** Use `clientIp()`. The leftmost
  entry is attacker-controlled. This applies to audit logs and security emails
  too — eight files were once writing forgeable addresses into audit trails.
- **Put the auth guard before `RateLimitPolicyGuard`** for any user-keyed
  policy, or it throws at request time.
- **Charge resource-keyed limits after the ownership check**, or a 429 becomes
  an oracle confirming the resource exists.
- **Auth endpoints must not leak.** Sensitive policies suppress
  `RateLimit-Remaining` (it tells a prober exactly when to rotate) and coarsen
  `Retry-After` to a 15 s grid. Messages are identical whether or not the
  account exists.
- **Don't let the client retry a 429.** React Query's retry predicate excludes
  4xx; a retried 429 spends another point against the budget that just
  refused.
- **Verify, don't reason.** Every wrong conclusion in this work came from
  reasoning about infrastructure instead of measuring it. The hop count was
  wrong twice before a 60-request bucket-distribution test settled it.

---

## 10. API contracts

The API is mounted under `/api` (user routes, `JwtGuard` unless noted) and
`/admin` (admin routes, `AdminJwtGuard`). No route takes a user id for the
caller; the caller always comes from the session. All routes below are
additive: installed apps that predate them never call them, and no existing
route or socket event changed shape. The security of the session itself is in
[SECURITY.md](SECURITY.md#2-sessions).

### Auth and session (selected)

| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/login` | Sets cookies on web. The installed app — identified by its `Origin` being one of `nativeAppOrigins` (`https://localhost` by default), which a page cannot forge; never by a custom header or User-Agent — also gets the access token, refresh token, expiry and session id in the body. A web caller's payload is byte-identical to before (the fields are absent). |
| POST | `/api/auth/session/refresh` | Rotates the refresh token. `includeProfile: true` runs `syncProfile` concurrently with the Supabase refresh and returns `user`/`meta` only after the refresh succeeded; failures omit it and the client falls back to `GET /api/auth/session`. Mid-session renewals don't ask for it. |
| GET | `/api/auth/session` | Current user (session probe). |
| POST | `/api/auth/session/adopt` | Signup handover: adopts the verified Supabase session; runs `syncProfile` before issuing the session. |
| GET | `/api/app/version` | Public, fails open; `cache-control: public, max-age=60`. Mobile version gate ([MOBILE_APP.md](MOBILE_APP.md#version-gate)). |

`request-password-reset` always answers `{ sent: true }` (no account
enumeration). Username/email availability checks remain, because a signup form
cannot work without them.

### Reauthentication (`/api/account/reauth`)

| Method | Path | Response |
|---|---|---|
| GET | `/api/account/reauth` | `{ methods }`: `password` when the Supabase user has an email identity, otherwise `email_code`. |
| POST | `/api/account/reauth/password` | `{ reauthToken, expiresAt }` |
| POST | `/api/account/reauth/code` | sends a code to the **current** sign-in address |
| POST | `/api/account/reauth/code/verify` | `{ reauthToken, expiresAt }` |

Grant semantics: [SECURITY.md](SECURITY.md#reauthentication-grants).

### Campus affiliation and account email

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/academics/colleges` (public) | — | colleges, each with `logoUrl` |
| GET | `/api/campus/affiliation` | — | `{ affiliation: null \| { collegeId, collegeName, logoUrl, email (masked), method, verifiedAt, active }, pending: null \| { collegeId, collegeName, emailMasked, expiresAt, resendAvailableAt } }` |
| POST | `/api/campus/affiliation/otp` | `{ collegeId, email }` (+ reauth grant when changing an existing college email) | `{ sent: true, emailMasked, expiresAt, resendAvailableAt }`; errors `invalid_college`, `domain_mismatch`, `college_email_unavailable`, `already_affiliated` (same address), `invalid_email`, `affiliation_revoked` (403), `reauth_required`, 429 |
| POST | `/api/campus/affiliation/verify` | `{ code }` | `{ affiliation }`; errors `invalid_code`, `expired_code`, `too_many_attempts`, `college_email_unavailable`, `invalid_college` / `domain_mismatch` (if disabled after the code was sent), `affiliation_revoked` |
| DELETE | `/api/campus/affiliation` | reauth grant, or legacy `{ password }` | `{ success: true }` — releases the address, clears the mirror; errors `invalid_password` (403), `affiliation_revoked` (403) |
| GET | `/api/account/email` | — | `{ email, collegeEmail, needsPersonalEmail }` |
| POST | `/api/account/email/otp` | `{ email }` (+ reauth grant) | `{ sent: true, emailMasked, expiresAt, resendAvailableAt }`; errors `email_taken`, `same_email`, `invalid_email`, 429 |
| POST | `/api/account/email/verify` | `{ code }` + reauth grant, or legacy `{ code, currentPassword }` (a body naming `email` is refused) | `{ email }`; errors `invalid_password` (403, code not burned), `invalid_code`, `expired_code`, `too_many_attempts`, `email_taken` (409), cooldown/`reauth_required` refusals |

Campus routes answer `403 { code: 'campus_affiliation_required' }` without an
active affiliation (see [FEATURES_AND_FLOWS.md](FEATURES_AND_FLOWS.md#1-signup-campus-and-college-email)).
Session/sync/profile user objects carry `gender`, `campusAffiliation` and
`profileCompletion: { needsPersonalEmail, needsGender }`; `PATCH
/api/users/me` accepts `gender` and never writes `email`.

OTP mechanics reuse `UserOtpService`: 10-minute TTL, 5 attempts, 60 s
cooldown, 5 sends/hour per purpose, 30 verifies / 15 min per IP, plus
`auth.otp.user` + `auth.otp.ip` on both send endpoints (shared with the
account-deletion codes) and `auth.verifypassword.user` on password-checked
endpoints. `UserOtpService.verifyBound` consumes the code atomically and
returns its bound `target`/`collegeId`; the caller applies those, never a
request value. `verify` (account deletion) still answers every failure as
`OTP_INVALID`.

### Admin: colleges and affiliation

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/admin/colleges`, `/admin/colleges/:id` | — | each college has `logoUrl: string \| null` |
| POST | `/admin/colleges/:id/logo` | multipart `file`: PNG / JPEG / WEBP, ≤ 2 MB | `{ logoUrl }`. **SVG is rejected (400)** (stored-XSS risk) |
| DELETE | `/admin/colleges/:id/logo` | — | `{ success: true }` |
| GET | `/admin/users/:id` | — | includes `collegeAffiliation: null \| { collegeId, collegeName, email, method, verifiedAt, revokedAt, revokedReason }` (full address: admin view) |
| PATCH | `/admin/users/:id/college-affiliation/revoke` | `{ reason }` (required, ≤ 300 chars) | `{ collegeAffiliation }`. Sets `revokedAt`, clears the mirror and `isCampusRep`; the address stays reserved; the user cannot re-verify or remove it |
| POST | `/admin/users/:id/reset-college` | — | **deletes** the affiliation (releasing the address) together with the mirror |

### Push

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/push/config` | `{ enabled, webPushPublicKey, web, android }` |
| PUT | `/api/push/devices` | register/refresh this device (`push.register`, 30/h) |
| POST | `/api/push/devices/unregister` | remove the caller's own device by token |
| GET | `/api/push/preferences` | `{ enabled, categories }` |
| PATCH | `/api/push/preferences` | master switch and/or categories (`push.preferences`, 60/h) |

Registration requires a live session (cookie session on web, `x-session-id` in
the app); a bare bearer token cannot register. Web endpoints must be https on
a known push service host (FCM, Mozilla autopush, Apple, WNS) because the
server POSTs to them (SSRF).

### Group chats (verification gate)

`@VerifiedOnly` is on `addMember`, `acceptJoinRequest` and `POST :id/join` /
`POST :id/request` on **both** controllers (`/api/group-chats` and
`/api/messages`). `GET :id/invite` stays readable and includes
`requiresVerification: boolean`. `acceptGroupJoinRequest` refuses an
ineligible requester with `403 { code: 'JOIN_REQUEST_INELIGIBLE' }` and deletes
that request. Details: [FEATURES_AND_FLOWS.md](FEATURES_AND_FLOWS.md#verification-gates).

### Endpoint inventory

At the 2026-09-09 security audit there were 313 endpoints: 194 user-JWT, 87
admin, 1 optional-auth, 31 public. (The mobile-auth analysis counted 146
controllers / ~321 route handlers behind `JwtGuard`.) Counts have grown since;
re-derive them from the code rather than trusting these.
