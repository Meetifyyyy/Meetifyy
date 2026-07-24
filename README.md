# 🚀 Meetifyy

Meetifyy is an all-in-one platform for campus communities, student activities, real-time messaging, and peer connections. Built as a high-performance monorepo, it powers real-time user experiences alongside a powerful Super Admin control panel.

> [!NOTE]
> Currently, only **Posts** and **Direct Messages (DMs)** features are fully functional. Other modules are under active development and refactoring.

---

## 🏗 Monorepo Architecture

```
meetifyy/
├── backend/          ← NestJS API Engine & Super Admin Backend (Port 4000)
├── frontend/         ← React + Vite Campus User Application (Port 5173)
├── admin-frontend/   ← React + Vite + TypeScript Super Admin Portal (Port 5174)
├── package.json      ← Monorepo root scripts & process orchestrator
└── start.bat         ← One-click Windows startup script
```

---

## ⚡ Quick Start (All Services)

You can launch all 3 applications (Backend, User Frontend, Super Admin Portal) simultaneously with a single command from the repository root:

```bash
# Install root dependencies
npm install

# Start all services concurrently
npm run dev
```

Alternatively, on Windows, simply double-click `start.bat` or run:
```cmd
.\start.bat
```

### Available Root Scripts

| Command | Action |
| :--- | :--- |
| `npm run dev` | Starts Backend (4000), Frontend (5173), and Admin (5174) concurrently |
| `npm run dev:backend` | Starts only the NestJS API server |
| `npm run dev:frontend` | Starts only the React user web application |
| `npm run dev:admin` | Starts only the Super Admin web application |

---

## 🛠 Prerequisites & Infrastructure

Before starting, ensure you have the following installed and configured:

- **Node.js**: `v18+` or `v20+`
- **npm**: `v9+`
- **Redis Server**: Required for BullMQ async queues, instant matching, and rate limiting.
  ```bash
  docker run -p 6379:6379 -d redis
  ```
- **Supabase PostgreSQL**: Create a project on [Supabase](https://supabase.com) and retrieve your connection strings.
- **Resend API Key**: Account on [Resend](https://resend.com) for sending login OTPs and verification emails.

---

## ⚙️ Service Setup & Environment Variables

### 1. Backend API (`backend/`)

Navigate to `/backend` and configure environment variables in `.env`:

```env
# Server Configuration
NODE_ENV=development
PORT=4000
CORS_ORIGINS=http://localhost:5173,http://localhost:5174

# Database (Supabase PostgreSQL)
DATABASE_URL="postgresql://postgres:password@host:5432/postgres"
DIRECT_URL="postgresql://postgres:password@host:5432/postgres"

# Supabase Auth
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379

# Resend Email Service
RESEND_API_KEY=re_your_api_key

# Super Admin Credentials & JWT Secrets
SUPER_ADMIN_EMAIL=admin@meetifyy.com
SUPER_ADMIN_PASSWORD=your_secure_password
ADMIN_JWT_ACCESS_SECRET=your-super-secret-admin-access-key-2026
ADMIN_JWT_REFRESH_SECRET=your-super-secret-admin-refresh-key-2026
ADMIN_JWT_PENDING_SECRET=your-super-secret-admin-pending-key-2026
```

Sync database schema and generate Prisma client:
```bash
cd backend
npx prisma db push
npx prisma generate
```

---

## 🔐 Super Admin Authentication Flow

1. Open the Super Admin Portal at `http://localhost:5174/login`.
2. Enter the administrator credentials configured in `backend/.env` (`SUPER_ADMIN_EMAIL` & `SUPER_ADMIN_PASSWORD`).
3. Enter the 6-digit OTP dispatched to the administrator's email via Resend.
4. Access platform metrics, user moderation tools, community approvals, and system logs.

---

## 🧰 Tech Stack

- **Backend**: NestJS, TypeScript, Prisma ORM, Supabase PostgreSQL, Redis (BullMQ, Socket.io), Resend API
- **User Application**: React, Vite, CSS Modules, Lucide React, Supabase Client
- **Super Admin Portal**: React, Vite, TypeScript, TailwindCSS / Lucide Icons
- **Tooling**: Concurrently, ESLint, Prettier
