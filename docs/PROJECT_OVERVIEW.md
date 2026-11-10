# Project overview

Meetifyy is a campus network for university students — activities,
communities, a feed, messaging and presence, in real time — delivered as a
website (PWA), an installed Android app built from the same code, and an admin
portal.

Related: [ARCHITECTURE.md](ARCHITECTURE.md) (how it is built),
[FEATURES_AND_FLOWS.md](FEATURES_AND_FLOWS.md) (how documented features work),
[DEVELOPMENT_GUIDE.md](DEVELOPMENT_GUIDE.md) (getting started).

---

## 1. What is in the repository

A monorepo of three deployable applications and the infrastructure that runs
them.

| | What it is | Stack | Deployed to |
|---|---|---|---|
| `backend/` | API, queues, realtime | NestJS 11, Node ≥ 22 | Azure Container Apps |
| `frontend/` | Student web app (PWA) and the Capacitor Android app | React 18, Vite 6 | Vercel (web); APK built locally |
| `admin-frontend/` | Admin portal | React 19, Vite 8, TypeScript | Vercel |

```
meetifyy/
├── backend/                  NestJS API
│   ├── prisma/               schema + migrations (the deployable unit)
│   ├── src/config/           the only place that reads process.env
│   ├── src/                  ~35 domain modules (auth, posts, activities, messages, push …)
│   ├── scripts/              TypeScript maintenance scripts
│   └── supabase-templates/   Supabase Auth emails, rendered per environment
├── frontend/                 student web app + installed app
│   ├── src/core/             portable API transport, endpoints, navigation intents
│   ├── src/platform/         web/ and capacitor/ implementations of typed contracts
│   ├── src/mobile/           the installed app's entry and native glue
│   ├── src/features/         feed, messages, campus, crew, instant-match, confessions …
│   ├── src/layout/, shared/, config/, styles/
│   ├── android/, ios/        committed Capacitor native projects
│   └── vercel.json
├── admin-frontend/           admin portal
├── docs/                     this documentation
├── scripts/                  deploy gates (await-ci.sh, await-backend.sh)
├── setup-azure-dev.sh        provisions the DEV Azure stack
├── setup-azure-prod.sh       provisions the PROD Azure stack (never run unasked)
├── vercel.json               Vercel config for the web frontend (mirrors frontend/vercel.json)
├── local/                    local-only helpers, APKs, Mailpit (git-ignored)
├── mobile/                   separate Expo/React Native app (its own repo; ignored here)
└── .github/workflows/        ci.yml · deploy-dev.yml · deploy-prod.yml
```

## 2. Features

Product areas, by frontend feature folder (`frontend/src/features/`) and
backend module:

| Area | What it covers | Documented design |
|---|---|---|
| Auth & onboarding | Open signup (any email), OTP verification, gender, profile completion, sessions on web and app | [FEATURES_AND_FLOWS.md](FEATURES_AND_FLOWS.md#1-signup-campus-and-college-email), [SECURITY.md](SECURITY.md) |
| Account verification | Live selfie + ID reviewed by admins (`verification`) | gates in [FEATURES_AND_FLOWS.md](FEATURES_AND_FLOWS.md#verification-gates) |
| Campus | Verified college email (`CollegeAffiliation`), campus directory, campus users, campus communities, campus events (campus reps) | [FEATURES_AND_FLOWS.md](FEATURES_AND_FLOWS.md#campus-gating) |
| Feed & posts | Posts, comments, replies, likes, bookmarks, polls, mentions, hashtags, share links; ranked "For You" feed (`ranking`) | — |
| Activities ("Crew") | Create/join activities, invitations, discussion | — |
| Communities | Public/private communities, join requests, moderators | push section of [FEATURES_AND_FLOWS.md](FEATURES_AND_FLOWS.md#categories) |
| Messaging | DMs, group chats, invite links, join requests, forwarding, voice notes, media, unsend | rate limits in [BACKEND_AND_API.md](BACKEND_AND_API.md#messaging) |
| Instant Match | Real-time matching queue and temporary chats | rate limits in [BACKEND_AND_API.md](BACKEND_AND_API.md#instant-match) |
| Confessions | Anonymous confessions with handles and reactions | — |
| Notifications & push | In-app notifications, web push, Android push | [FEATURES_AND_FLOWS.md](FEATURES_AND_FLOWS.md#2-push-notifications) |
| Presence & realtime | Online status, typing, receipts over Socket.IO | [BACKEND_AND_API.md](BACKEND_AND_API.md#4-realtime-socketio) |
| Search | People, communities, content | — |
| Settings & account | Email changes, password, devices/sessions, notification preferences, account deletion | [SECURITY.md](SECURITY.md#8-email-change-security) |
| Help, legal, support | Help centre, legal documents with acknowledgement, support tickets | [FEATURES_AND_FLOWS.md](FEATURES_AND_FLOWS.md#help-and-legal-copy) |
| Admin portal | Users, verification queue, colleges and logos, reports/moderation, sessions, analytics and error logs, audit, legal, support, campus reps, account deletion | — |

"—" means there is no written design beyond the code; read the module.

## 3. Environments at a glance

| | local | development | production |
|---|---|---|---|
| Web | Vite dev server | `dev.meetifyy.app` | `meetifyy.app` |
| Admin | Vite dev server | `dev-admin.meetifyy.app` | `admin.meetifyy.app` |
| API | `localhost:4000` | `dev-api.meetifyy.app` | `api.meetifyy.app` |
| Branch | — | `development` | `main` |
| Access | — | web and admin behind Cloudflare Access | website public; admin behind Cloudflare Access |
| Email | Mailpit | Resend + Brevo | Resend + Brevo |

Development and production are fully separate (different Azure subscriptions,
Microsoft accounts, Supabase projects, Cloudflare accounts, Redis, Sentry
orgs). Details: [INFRASTRUCTURE.md](INFRASTRUCTURE.md).

## 4. Terminology

| Term | Meaning |
|---|---|
| **APK / installed app / the app** | The Capacitor Android build of `frontend/` (origin `https://localhost`). |
| **Website / web** | The same frontend served by Vercel. |
| **Affiliation** | A verified college email linking a user to a college (`CollegeAffiliation`); grants Campus access. |
| **Selfie verification / verified** | Admin-reviewed live selfie + ID (`User.verificationStatus`); gates messaging and creating content. |
| **Mirror** | `User.collegeId` / `User.collegeEmail`, kept equal to the active affiliation. |
| **Grant** | A short-lived reauthentication token for sensitive account changes. |
| **Session family / login** | All rotations of one sign-in (`UserSession.familyId`). |
| **Policy** | A named rate limit in `rate-limit.config.ts`. |
| **DEV / PROD** | The deployed development and production environments. |
