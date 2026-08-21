# Meetifyy

Meetifyy is a campus network platform designed for university students to connect, organize activities, discover communities, and interact in real-time. Built as a monorepo, it brings together the core student web application, an admin management portal, and a backend service.

---

## 📁 Repository Structure

```
meetifyy/
├── backend/                  # NestJS API Server & Service Engine
│   ├── prisma/               # Database schema, migrations, & seed data
│   ├── src/                  # Core API modules (auth, posts, messaging, presence, etc.)
│   └── supabase-templates/   # Static Auth email templates
│
├── frontend/                 # Main Student Web Application (React + Vite)
│   ├── public/               # Static assets, fonts, icons, & offline files
│   └── src/
│       ├── features/         # Modular feature apps (feed, messaging, campus, crew, etc.)
│       ├── layout/           # Shared page layouts, headers, & sidebars
│       └── shared/           # Reusable UI components, hooks, & state stores
│
└── admin-frontend/           # Super Admin Portal (React + Vite + TypeScript)
    └── src/                  # Admin dashboard pages, audit tools, & moderation views
```

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
the deployable unit — Railway runs `prisma migrate deploy` as its pre-deploy step and
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
