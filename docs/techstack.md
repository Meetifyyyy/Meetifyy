# Tech stack

Three deployable applications plus the managed services behind them. Versions
are the ones actually installed; check `package.json` if this drifts.

## Applications

| | Runtime | Framework | Deployed to |
|---|---|---|---|
| **backend** | Node ≥ 22 | NestJS 11 | Azure Container Apps |
| **frontend** | — | React 18 + Vite 6 (JS) | Vercel |
| **admin-frontend** | — | React 19 + Vite 8 (TypeScript) | Vercel |

The two frontends deliberately differ. `frontend` is JavaScript and carries the
PWA, offline and realtime surface; `admin-frontend` is TypeScript, has no
Supabase credentials at all, and talks only to the backend using admin JWTs — so
a compromised admin bundle exposes no database access.

## Backend

- **NestJS 11** with modular domains under `src/`: `auth`, `posts`,
  `activities`, `communities`, `messages`, `notifications`, `moderation`,
  `instant-match`, `verification`, `account-deletion`, `support`, `admin`,
  and ~15 more.
- **Prisma 6** with the **`@prisma/adapter-pg` driver adapter** — queries run
  through node-postgres, not Prisma's Rust engine. This matters: see
  [operations.md](operations.md) for why `pgbouncer=true` must not be set.
- **BullMQ 5** on Redis for five queues: email, notifications, moderation,
  account-deletion, instant-match.
- **Socket.IO 4** (`@nestjs/platform-socket.io`) for realtime and presence.
- **Supabase JS 2** for auth; user JWTs are verified locally against the
  project's JWKS.
- **AWS SDK v3 S3 client** pointed at Cloudflare R2.
- **Resend** for transactional mail, with templates authored as React Email
  components and rendered to HTML.
- **Sentry** and **Helmet**.

Configuration is centralised: `src/config/env.ts` is the only place that reads
`process.env`, everything else imports the typed `config` object. Validation
runs once at import, so a misconfigured environment fails at boot with one
message listing every problem rather than at the first request that needs the
value.

## Frontend

React 18, Vite 6, React Router 7, TanStack Query 5, Zustand 5, Framer Motion,
`socket.io-client`, `vite-plugin-pwa` for the installable/offline build.

Media uploads go **directly to R2** via a presigned PUT rather than streaming
through the API, with a fall back to a backend pass-through if CORS blocks it.

## Admin frontend

React 19, Vite 8, TypeScript 6, React Router 7, TanStack Query 5, Recharts.

## Managed services

| Service | Used for |
|---|---|
| **Supabase** | Postgres + Auth. Separate project per environment. |
| **Cloudflare R2** | All object storage. Two buckets: public media, private verification documents. |
| **Cloudflare DNS** | The `meetifyy.app` zone, plus Zero Trust Access. |
| **Resend** | Transactional email, and the SMTP relay Supabase Auth sends through. |
| **Azure Container Apps** | Backend compute, Redis, and migration jobs. |
| **Vercel** | Both frontends. |
| **Sentry** | Error tracking (optional). |

Object storage is R2 only — `STORAGE_PROVIDER` is a validated single-value knob,
so a deployment still set to `supabase` fails loudly at boot rather than
silently resolving media against a bucket that no longer exists.
