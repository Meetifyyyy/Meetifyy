# Meetifyy

A campus network for university students — activities, communities, feed,
messaging and presence, in real time.

The repo is a monorepo of three deployable applications and the infrastructure
that runs them.

| | What it is | Stack | Deployed to |
|---|---|---|---|
| `backend/` | API, queues, realtime | NestJS 11, Node ≥ 22 | Azure Container Apps |
| `frontend/` | Student web app (PWA) | React 18, Vite 6 | Vercel |
| `admin-frontend/` | Admin portal | React 19, Vite 8, TypeScript | Vercel |

---

## Documentation

Four documents, kept current:

| Doc | Read it when |
|---|---|
| [docs/techstack.md](docs/techstack.md) | You want the full dependency picture |
| [docs/project-structure.md](docs/project-structure.md) | You need to know how local, dev and prod differ |
| [docs/azure-setup.md](docs/azure-setup.md) | You're provisioning, deploying, or moving Azure accounts |
| [docs/operations.md](docs/operations.md) | **Before changing anything in production** |

`operations.md` is the one that saves time. Every entry in it is a real failure
that already happened, and they all share a shape: nothing errors at the time,
and you find out later — in a user's inbox, or five deploys into an outage.

---

## Repository layout

```
meetifyy/
├── backend/                  NestJS API
│   ├── prisma/               schema + 44 migrations
│   ├── src/config/           the only place that reads process.env
│   ├── src/                  ~30 domain modules (auth, posts, activities, …)
│   └── supabase-templates/   Auth emails, rendered per environment
│
├── frontend/                 student web app
│   └── src/
│       ├── config/           build-time public config
│       ├── features/         feed, messaging, campus, crew, instant-match …
│       ├── layout/           shells, headers, sidebars
│       └── shared/           components, hooks, stores
│
├── admin-frontend/           admin portal
├── docs/                     the four documents above
├── setup-azure-dev.sh        provisions the DEV Azure stack
├── setup-azure-prod.sh       provisions the PROD Azure stack
└── .github/workflows/        ci.yml · deploy-dev.yml · deploy-prod.yml
```

---

## Getting started

```bash
npm install
cp backend/.env.example        backend/.env.local
cp frontend/.env.example       frontend/.env.local
cp admin-frontend/.env.example admin-frontend/.env.local
# fill in development credentials, then:
npm run dev:services
```

`dev:services` runs Mailpit, the backend, the frontend and the admin portal
together. Mail goes to Mailpit at <http://localhost:8025> instead of to real
inboxes. Individual targets exist too: `dev:backend`, `dev:frontend`,
`dev:admin`.

### Configuration

Every environment-specific value — domains, database, email, storage, auth
redirects, cookies, CORS — comes from environment variables read through a
central config layer. **No source file needs editing to move between
environments.**

- `backend/src/config/env.ts` is the only place in the backend that touches
  `process.env`. Everything else imports the typed `config` object.
- Validation runs once at import, so a misconfigured environment fails at boot
  with one message listing every problem — not at the first request that happens
  to need the value.
- Each app's `.env.example` and `.env.production.example` are the authoritative,
  annotated variable lists, marking what is required, what is secret, and what is
  inlined at build time.

Only `*.example` files are committed. Real `.env` files are git-ignored by a
deny-all rule, and `git check-ignore` is the way to confirm before you commit.

Frontend variables are inlined by Vite at **build** time, so they must exist in
Vercel before the build runs, and changing one requires a redeploy. Nothing in a
`VITE_` variable is secret — it ships in the bundle.

---

## Branches and environments

| Branch | Deploys to | Database | GitHub environment |
|---|---|---|---|
| `feature/*` | — (CI only) | — | — |
| `development` | Azure DEV (`meetifyy-api-dev`) | Supabase DEV | `development` |
| `main` | Azure PROD (`meetifyy-api`) | Supabase PROD | `Production` |

Dev and prod live in **separate Azure subscriptions on separate Microsoft
accounts** — not for tidiness, but because a subscription may hold only one
Container Apps environment. See [docs/azure-setup.md](docs/azure-setup.md).

### Contribution flow

```
1. branch from development        git switch -c feature/your-change development
2. commit                         schema + migrations together, always
3. push, open a PR into development
4. CI must pass, then merge       → DEV deploys, DEV migrations run
5. test on dev.meetifyy.app
6. open a PR: development → main
7. review, then merge             → PROD deploys, PROD migrations run
```

Both deploys are automatic on merge. Nothing is deployed by hand.

---

## Database changes — always use migrations

**Never run `prisma db push`.** When you change `backend/prisma/schema.prisma`,
create a migration:

```bash
cd backend && npx prisma migrate dev --name describe_your_change
```

Then **commit the generated folder** under `backend/prisma/migrations/`. That
folder is the deployable unit — the workflows run `prisma migrate deploy` as a
pre-deploy step and apply exactly those files, in order. A schema change without
a committed migration never reaches production, and the app boots expecting a
column that isn't there.

Why `db push` is banned rather than discouraged:

- It force-matches the database to `schema.prisma` and **drops whatever doesn't
  match** — including columns holding real user data — with no migration to
  review and no rollback.
- It records nothing, so `_prisma_migrations` stops describing the real
  database. This repo has already been bitten: migration files sat unapplied on
  disk while the database quietly had their changes, and reconciling the two
  meant comparing databases column by column.

| Command | Use |
|---|---|
| `npx prisma migrate dev --name <x>` | Local only. Creates + applies a migration. |
| `npx prisma migrate deploy` | Deployed environments. Applies pending migrations; never drops. |
| `npx prisma migrate status` | Check whether the DB matches migration history. |
| `npx prisma migrate resolve --applied <x>` | Mark a hand-applied migration as done. |

`migrate dev` is the sharp one: against a drifted database it offers to
**reset (wipe) it**. Run it only against your own dev database.

Migrations run **before** the new image is deployed, so the schema is always
ahead of or equal to the running code. Because a rollback reverts code but not
migrations, **every migration must be backward-compatible with the previous
release**.

---

## Deploy pipeline

```
push → ci.yml passes → build image → push to ACR
     → prisma migrate deploy (one-shot Container App Job)
     → update Container App → health check
```

If a migration fails the workflow exits non-zero and the old app keeps running
against the unchanged database.

The production database URL is read from the Container App's own secret store at
deploy time and **never becomes a GitHub secret**. Any change to the pipeline
must preserve that property.

---

## Safety rails worth knowing

The codebase actively prevents several cross-environment mistakes:

- **`isolation.guard.ts`** refuses to boot a production process whose database,
  Redis, R2 bucket or URLs are named like dev resources — catching a
  copy-pasted `DATABASE_URL` at startup rather than at the first request. It
  inspects hostnames only, never credentials.
- **`STORAGE_PROVIDER`** is a validated single-value knob, so a deployment still
  set to `supabase` fails loudly instead of silently resolving media against a
  bucket that no longer exists.
- **Verification uploads** are routed by key prefix to a private bucket, so a new
  call site cannot accidentally publish identity documents.
- **Supabase Auth templates** are rendered per environment, and the production
  render fails hard if any dev URL survives into the output.
