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
