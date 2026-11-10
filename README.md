# Meetifyy

A campus network for university students — activities, communities, feed,
messaging and presence, in real time.

The repository is a monorepo of three deployable applications and the
infrastructure that runs them.

| | What it is | Stack | Deployed to |
|---|---|---|---|
| `backend/` | API, queues, realtime | NestJS 11, Node ≥ 22 | Azure Container Apps |
| `frontend/` | Student web app (PWA) and the Capacitor Android app | React 18, Vite 6 | Vercel |
| `admin-frontend/` | Admin portal | React 19, Vite 8, TypeScript | Vercel |

## Quick start

```bash
npm install
cp backend/.env.example        backend/.env.local
cp frontend/.env.example       frontend/.env.local
cp admin-frontend/.env.example admin-frontend/.env.local
# fill in development credentials, then:
npm run dev:services
```

`dev:services` runs Mailpit (<http://localhost:8025>), the backend, the web
frontend, the admin portal and the mobile dev server together. Full setup,
testing and the contribution flow: [docs/DEVELOPMENT_GUIDE.md](docs/DEVELOPMENT_GUIDE.md).

## Documentation

Everything lives in [`docs/`](docs/README.md). Start with:

- [Project overview](docs/PROJECT_OVERVIEW.md) — what is here
- [Architecture and stack](docs/ARCHITECTURE.md)
- [Infrastructure and operations](docs/INFRASTRUCTURE.md) — **read before changing anything in production**
- [Decisions and guidelines](docs/DECISIONS_AND_GUIDELINES.md) — the rules every change follows

Branches: `development` deploys to DEV, `main` deploys to PROD, both
automatically on merge. Never run `prisma db push`; every schema change ships
as a committed migration ([docs/DATABASE.md](docs/DATABASE.md)).
