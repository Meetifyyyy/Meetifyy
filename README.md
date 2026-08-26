# Meetifyy

Meetifyy is a campus network platform designed for university students to connect, organize activities, discover communities, and interact in real-time. Built as a monorepo, it brings together the core student web application, an admin management portal, and a backend service.

---

## 📁 Repository Structure

```
meetifyy/
├── backend/                  # NestJS API Server & Service Engine
│   ├── prisma/               # Database schema, migrations, & seed data
│   ├── src/config/           # Central configuration layer (env loading + validation)
│   ├── src/                  # Core API modules (auth, posts, messaging, presence, etc.)
│   └── supabase-templates/   # Static Auth email templates
│
├── frontend/                 # Main Student Web Application (React + Vite)
│   ├── public/               # Static assets, fonts, icons, & offline files
│   └── src/
│       ├── config/           # Central configuration layer (public, build-time values)
│       ├── features/         # Modular feature apps (feed, messaging, campus, crew, etc.)
│       ├── layout/           # Shared page layouts, headers, & sidebars
│       └── shared/           # Reusable UI components, hooks, & state stores
│
└── admin-frontend/           # Super Admin Portal (React + Vite + TypeScript)
    └── src/                  # Admin dashboard pages, audit tools, & moderation views
```

---

## ⚙️ Configuration & getting started

Every environment-specific value — domains, database, email, storage, auth
redirects, cookies, CORS — is supplied by environment variables and read through
a central configuration layer. No source file needs editing to move between
local, staging and production.

```bash
cp backend/.env.example        backend/.env.local
cp frontend/.env.example       frontend/.env.local
cp admin-frontend/.env.example admin-frontend/.env.local
# fill in your development credentials, then:
npm install
npm run dev
```

The config layers live at `backend/src/config/`, `frontend/src/config/` and
`admin-frontend/src/config/`. Application code imports `config` from there rather
than reading `process.env` / `import.meta.env` directly.

Each app's `.env.example` is the annotated, authoritative list of its variables,
including which are required, which are public, and which are read at build time
rather than at runtime.

---

## 🛠 Tech Stack

- **Backend**: NestJS, TypeScript, Prisma ORM, Supabase (PostgreSQL & Auth), Cloudflare R2 (Storage), Redis (BullMQ queues, Rate Limiting, Presence), Resend API, Mailpit
- **User Application**: React, Vite, Vanilla CSS Modules, Lucide Icons, Supabase Client
- **Super Admin Portal**: React, Vite, TypeScript, TailwindCSS / Lucide Icons

---

## 🗄 Database changes — always use migrations

**Never run `prisma db push`.** When you change `backend/prisma/schema.prisma`, create a
migration instead:

```bash
cd backend && npx prisma migrate dev --name describe_your_change
```

Then **commit the folder it generates** under `backend/prisma/migrations/`. That file is
the deployable unit — Azure Container Apps runs `prisma migrate deploy` as a pre-deploy step and
applies exactly those files, in order. A schema change without a committed migration
simply never reaches production, and the app boots expecting a column that isn't there.

Why `db push` is banned rather than merely discouraged:

- It force-matches the database to `schema.prisma` and **drops whatever doesn't match** —
  including columns holding real user data — with no migration to review and no rollback.
- It records nothing, so `_prisma_migrations` stops describing the real database. This
  repo has already been bitten by that: migration files sat unapplied on disk while the
  database quietly had their changes, and reconciling the two required comparing databases
  column by column.
- It ran on every container start, not just deploys, so drift got "corrected" unattended.

Useful commands:

| Command | Use |
| --- | --- |
| `npx prisma migrate dev --name <x>` | Local only. Creates + applies a migration. |
| `npx prisma migrate deploy` | Production. Applies pending migrations; never drops. |
| `npx prisma migrate status` | Check whether the DB matches the migration history. |
| `npx prisma migrate resolve --applied <x>` | Mark a hand-applied migration as done. |

`migrate dev` is the only sharp one: against a database whose history has drifted it will
offer to **reset (wipe) it**. Run it only against your own dev database, never production.
---

## 🌿 Branch → Environment mapping

| Branch | Deploys to | Database |
|--------|-----------|----------|
| `feature/*` | — (CI only) | — |
| `development` | Azure DEV (`meetifyy-api-dev`) | Supabase DEV |
| `main` | Azure PROD (`meetifyy-api`) | Supabase PROD |

Schema changes flow:

```
1. Modify schema.prisma locally
2. npx prisma migrate dev --name your_change   ← creates migration file
3. Commit schema.prisma + migrations/ together
4. Push to development → DEV deploy + DEV migration runs automatically
5. Test in DEV
6. PR: development → main → PROD deploy + PROD migration runs automatically
```

`prisma migrate deploy` (used in both deployment workflows) applies only the
migration files already committed to Git. It never generates migrations and
never touches schema outside the committed SQL files.

See `AZURE_SETUP.md §23` for the complete architecture and workflow guide.
