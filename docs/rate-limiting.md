# Rate limiting

How abuse prevention works in this backend, what is deployed today, what is
deliberately not built yet, and the things that will bite as the user base
grows.

Last verified against production 2026-09-05, policy v7.

---

## 1. Where everything lives

| File | Role |
| --- | --- |
| `src/config/rate-limit.config.ts` | **The single source of truth.** Every limit, as a literal. Also the trust-proxy hop count and key namespace. |
| `src/common/rate-limit/rate-limit.service.ts` | The only thing that talks to `rate-limiter-flexible`. Owns identifiers, Redis, fallbacks, logging. |
| `src/common/rate-limit/client-ip.util.ts` | Resolves the client address. **Nothing else may read `x-forwarded-for`.** |
| `src/common/rate-limit/rate-limit.decorator.ts` | `@RateLimit('policy.name')` |
| `src/common/rate-limit/rate-limit-policy.guard.ts` | Enforces whatever a route declares |
| `src/common/rate-limit/rate-limit.response.ts` | The 429 shape and headers |
| `src/common/guards/ratelimit.guard.ts` | The global tier, applied to every route |
| `src/messages/core/message-limits.ts` | Messaging limits, shared by both send implementations |

Limit **values are not environment variables**, deliberately. A limit that can
be weakened by an env var gets weakened during an incident, and it makes "the
same limits everywhere" unenforceable. The environment supplies only
infrastructure: Redis URL, key prefix, hashing secret, proxy hop count.

Changing a number is a reviewed commit **and a `POLICY_VERSION` bump** — the
version prints in the startup banner and on every rejection, so a shift in the
metrics can be traced to a revision, and a deploy can be confirmed from logs.

---

## 2. Adding a limit

Two lines, in most cases.

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
id before the controller runs). Enforce it in the service, *after* the ownership
check, so a 429 can never confirm a resource exists. See
`assertSendWithinRateLimit`.

---

## 3. Current limits

### Global tiers — every route

| Policy | Limit | Key |
| --- | --- | --- |
| `global.user` | 300/min | user |
| `global.ip` | 120/min | IP |
| `global.ip.burst` | 25/10s | IP |

**The two tiers are mutually exclusive.** Once a request carries a verified JWT
the user tier governs and the IP tier is skipped entirely. This is not an
optimisation — a campus NAT gateway presents thousands of students as one
address, and applying the IP tier to authenticated traffic would take a whole
campus down at peak.

`/health` is exempt. A rate-limited health check causes the outage it reports.

### Authentication

| Policy | Limit | Key |
| --- | --- | --- |
| `auth.login.ip` | 10/5m, then blocked 5m | IP |
| `auth.login.account` | 6/15m, then blocked 15m | account |
| `auth.probe.ip` | 20/min | IP |
| `auth.probe.daily` | 200/day | IP |
| `auth.otp.user` | 5/15m | user |
| `auth.otp.cooldown` | 1/60s | user |
| `auth.otp.ip` | 20/day | IP |
| `auth.emailtrigger.user` | 6/hour | user |
| `auth.collegerequest.ip` | 5/day | IP |
| `auth.collegerequest.email` | 3/day | account |
| `admin.login.ip` | 8/5m, then blocked 30m | IP |
| `admin.login.account` | 5/15m, then blocked 30m | account |

Two things worth understanding here:

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
60s floor. Going below it would replace our clear message with an opaque
upstream 429.

### Messaging

Keyed on the **operation**, never the path. `/api/messages`, `/api/dm`,
`/api/group-chats` and the `message:send` socket event are four entry points
onto one action; a per-path limit is bypassed by rotating between them.

| Policy | Limit | Key |
| --- | --- | --- |
| `msg.send.user` | 60/min | user |
| `msg.send.conversation` | 40/min | user + conversation |
| `msg.forward.user` | 30/min | user |
| `msg.startconv.user` | 25/hour | user |
| `msg.creategroup.user` | 8/hour | user |

`MAX_FORWARD_TARGETS = 15` caps fan-out per forward, and **forwarding costs one
point per destination** — otherwise one request reaches fifty conversations for
the price of one. The cap and the budget must stay in step: if the cap ever
exceeds the budget, every maximum-size forward is refused outright and the
feature looks broken rather than limited.

New-conversation limits are charged **only for genuine first contact**. `startDM`
and `startConversation` return the *existing* conversation when there is one —
that is how the UI opens an old thread — so the charge sits past that branch,
beside the verification gate placed there for the same reason.

### Realtime

| Policy | Limit | Key | On breach |
| --- | --- | --- | --- |
| `socket.connect.ip` | 40/min | IP | refuse |
| `socket.connect.user` | 10/min | user | refuse |
| `socket.catchup.user` | 10/min | user | error ack |
| `socket.roomjoin.user` | 60/min | user | error ack |
| typing | 15/10s | user+conv | **silent drop** |
| heartbeat / ping | 6/min | socket | **silent drop** |

Connection limiting is two tiers and **the order is load-bearing**. The per-IP
tier runs *before* token verification, because `validateToken` falls back to a
remote Supabase call when local verification fails — so a garbage-token flood
would otherwise become one outbound Supabase request per attempt, turning our
own handshake into an amplifier against our auth provider. It stays coarse (40)
because a campus shares one address. The per-user tier runs after and can be
tight (10) because it has no shared-address problem.

Ephemeral events are dropped **silently** and never error. A lost typing
indicator is invisible; one that raises an error toast is a bug.

### Instant Match

| Policy | Limit | Key |
| --- | --- | --- |
| `im.join.user` | 10/min | user |
| `im.join.hourly.user` | 40/hour | user |
| `im.join.ip` | 25/hour | IP |
| `im.respond.user` | 30/min | user |
| `im.queuesync.user` | 20/min | user |

Previously counted in one process's memory, so the real ceiling was multiplied
by replica count and reset on every deploy.

### Support

`support.request.ip` 5/hour, `support.request.email` 3/hour. Both are consumed
even when the first rejects, so the cheaper key cannot be probed by someone who
knows the expensive one will refuse.

---

## 4. Identifiers, and the trust-proxy story

| Dimension | Source | Notes |
| --- | --- | --- |
| `user` | verified JWT (or admin cookie) | unforgeable |
| `ip` | `req.ip` **only** | hashed before use; IPv6 collapsed to /64 |
| `account` | submitted email/identifier | normalised, hashed; always paired with an IP dimension |
| `resource` | server-resolved id | enforced in the service, after authorization |

IPs and emails are HMAC-hashed before they become Redis keys or log fields.
IPv6 is collapsed to its /64 because a single customer allocation is 2^64
addresses — per-address keying would hand an IPv6 client unlimited buckets.

### `TRUST_PROXY_HOPS` — read this before changing it

**Production is 2. This was measured, not reasoned about, and reasoning about
it was wrong twice.**

`api.meetifyy.app` is a Cloudflare CNAME set to **DNS-only (grey cloud)**, so
Cloudflare is not in the request path. Azure Container Apps is, and it adds
**two** entries to `X-Forwarded-For`: the client, then its own internal envoy
hop. Those envoy addresses **rotate per TCP connection**.

With `hops=1` Express took the rightmost entry — the rotating envoy address — so
**60 requests from one machine produced 16 different buckets**, and every
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

> **If Cloudflare's orange cloud is ever enabled for `api`, this must become 3
> at the same moment.** Enabling proxying without changing it collapses every
> user into one bucket and 429s anonymous traffic platform-wide.

### Known gap: the Vercel failover path

`vercel.json` rewrites `/_api/*` to the same backend, used when the direct host
is unreachable. That path has one more hop, so traffic arriving through it
resolves to Vercel's egress address and shares one bucket. This is a stable,
unspoofable wrong value; it only applies while the direct API is down; and
authenticated users are unaffected because they are counted per user. Revisit
if that path ever carries normal traffic.

---

## 5. Failure behaviour

Redis is resolved **per call**, never captured at construction. An earlier
version stored the client in a guard constructor; ioredis connects lazily, so a
process that started before Redis was ready had rate limiting silently disabled
for its entire lifetime.

| Class | On Redis failure |
| --- | --- |
| auth, OTP, messaging, uploads | fall back to a per-instance in-memory limiter and **keep enforcing** |
| reads, feed, search | allow |

Rejection is distinguished from store failure **by shape**, not `instanceof
Error` — otherwise a bug inside the limiter is indistinguishable from an outage
and everything fails open.

Every fallback logs `ratelimit.degraded` at ERROR. **That line should never
appear.** If it does, limits are not shared across instances.

---

## 6. Observability

Every rejection emits:

```json
{"policy":"msg.send.conversation","dimension":"resource","subject":"f5ad9a281451",
 "limit":40,"window":60,"resetSeconds":58,"mode":"enforce","degraded":false,
 "policyVersion":7,"env":"production"}
```

`subject` is a short one-way hash — never a user id, address or email. It exists
because **a rejection count alone cannot tell you whether a limit is too tight**.
Many people each hitting it once, and one person hitting it fifty times, look
identical in a total and opposite in a breakdown.

Log Analytics (Portal → workspace → Logs):

```kql
ContainerAppConsoleLogs_CL
| where TimeGenerated > ago(7d)
| where ContainerAppName_s == "meetifyy-api"
| where Log_s has "ratelimit.rejected"
| extend policy  = extract('"policy":"([^"]+)"', 1, Log_s)
| extend subject = extract('"subject":"([^"]+)"', 1, Log_s)
| summarize rejections = count(), people = dcount(subject) by policy
| extend perPerson = round(todouble(rejections) / people, 1)
| order by rejections desc
```

| `perPerson` | Meaning | Action |
| --- | --- | --- |
| ~1–2 | many people, once each | **too tight — raise it** |
| 10+ | few people, hammering | working correctly |

`az containerapp logs show` caps `--tail` at **300**; use Log Analytics for
anything historical.

---

## 7. Environments

Identical values everywhere — local, dev, staging, production, CI. The
`FEATURE_RELAXED_RATE_LIMITS` flag was removed; it defaulted to on outside
production, which is why the defects above went unnoticed for so long.

`RATE_LIMIT_MODE=shadow` evaluates and logs every policy without rejecting
anything. Use it to measure a new limit against real traffic before enforcing.
**Refused in production**, so it cannot become an accidental bypass.

Per-environment: `REDIS_URL`, `RATE_LIMIT_KEY_PREFIX`, `RATE_LIMIT_HASH_SECRET`,
`TRUST_PROXY_HOPS`, log destination. Nothing else.

---

## 8. Not implemented yet

Ordered by what I would do next.

| Gap | Why it matters |
| --- | --- |
| **Content creation limits** — posts, comments, likes, follows | Nothing bounds a user posting continuously. The spec'd shape is a short window *plus* a daily quota, because slow-drip spam passes every per-minute limit. |
| **Report/moderation limits, esp. per-target** | Report-bombing one profile is both harassment and a moderation-queue DoS. A per-user limit alone permits it. |
| **Media upload count + concurrency** | 50 MB/file is enforced; *count* and *concurrency* are not. `sharp` is CPU-bound, and parallel large images starve the event loop. Concurrency matters more than rate here. |
| **Search / directory daily quotas** | The campus directory is the obvious scraping target. A per-minute limit still permits full extraction, just slowly. |
| **Concurrent socket connection cap per user** | We limit how *fast* you connect, not how *many* at once. Needs cross-replica connection state in Redis with cleanup on disconnect — and if a process crashes, stale entries lock that user out. Deliberately deferred rather than shipped fragile. |
| **Email daily ceiling enforcement** | `EmailUsageService` counts sends per provider per day but never refuses. Should reserve headroom so password resets survive a spike. |
| **Edge/WAF layer** | Every request the app rejects still costs a TLS handshake and a Redis round-trip. Volumetric junk should be dropped before it reaches Node. |
| **Dashboards + alerts** | The KQL above is manual. Nothing pages anyone today. |

---

## 9. What will bite as the user base grows

**`msg.send.conversation` (40/min) is the most likely false positive.** A lively
group chat with several people talking is the realistic case. It is also the
only limit set without production data behind it. Watch its `perPerson` ratio
first.

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
are shared by *everyone*. **The OTP budget is the one that will hurt first** — 30
per hour across the entire platform. Our own limits sit below these, but at a
few thousand active users this becomes a hard capacity ceiling and needs its own
monitoring. It is an upstream dependency, not just a security control.

**Redis is now in the request path of every call.** Each request costs at least
one round-trip; composite policies cost two or three. Redis runs as a single
Container App replica with 0.25 CPU / 0.5 GB. **This is a single point of
failure for the whole API's latency.** Watch Redis command latency p99 and
memory. Key cardinality is bounded (active identifiers × policies) and every key
carries a TTL, so unbounded growth is not a risk — capacity and availability are.

**Redis reconnect behaviour is a live concern.** `redis.service.ts` has
`retryStrategy: times > 5 ? null : ...` — returning `null` means **stop retrying
permanently**, so a client that fails six reconnects is dead for the life of the
process. Production logs show the subscriber reconnecting roughly every five
minutes (Azure kills idle internal TCP connections), so the retry path is
exercised constantly. If it ever exhausts, rate limiting silently degrades to
per-instance counting until a restart. `ratelimit.degraded` would fire, but it
will not self-heal. **This is unfixed and is the single most likely cause of a
future "limits stopped working" incident.**

**Scaling past one replica changes assumptions.** `maxReplicas` is currently 1.
Redis-backed limits are already correct across instances, but the *in-process*
pieces are not, by design: ephemeral socket throttles and the insurance limiter
both count per process. At N replicas the effective ephemeral ceiling is N×. That
is acceptable for typing indicators; it would not be for anything durable.

**The `/api/messages` alias family should be deprecated.** Three controllers
implementing one feature is the root cause of the alias bypass; the shared budget
is a mitigation, not a fix. Any *new* messaging operation must be added to
`message-limits.ts`, not to a controller, or the bypass reopens.

---

## 10. Things to be careful of

- **Never read `x-forwarded-for` directly.** Use `clientIp()`. The leftmost entry
  is attacker-controlled. This applies to audit logs and security emails too —
  eight files were writing forgeable addresses into audit trails.
- **Put the auth guard before `RateLimitPolicyGuard`** for any user-keyed policy,
  or it throws at request time.
- **Charge resource-keyed limits after the ownership check**, or a 429 becomes an
  oracle confirming the resource exists.
- **Auth endpoints must not leak.** Sensitive policies suppress
  `RateLimit-Remaining` (it tells a prober exactly when to rotate) and coarsen
  `Retry-After` to a 15s grid. Messages are identical whether or not the account
  exists.
- **Bump `POLICY_VERSION`** for anything that changes limit *behaviour*, not just
  the numbers — identifier resolution counts.
- **Don't let the client retry a 429.** React Query's retry predicate excludes
  4xx; a retried 429 spends another point against the budget that just refused.
- **Verify, don't reason.** Every wrong conclusion in this work came from
  reasoning about infrastructure instead of measuring it. The hop count was wrong
  twice before a 60-request bucket-distribution test settled it.
