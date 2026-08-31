# Meetifyy Azure Setup Guide

> Complete guide for deploying the Meetifyy backend to Microsoft Azure Container Apps from scratch.

---

## 1. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      GitHub                                 │
│  Push to main branch                                        │
└────────────────────────┬────────────────────────────────────┘
                         │ GitHub Actions (azure-deploy.yml)
                         ▼
┌─────────────────────────────────────────────────────────────┐
│            Azure Container Registry (ACR)                   │
│  meetifyycr.azurecr.io/meetifyy-api:<sha>                   │
└────────────────────────┬────────────────────────────────────┘
                         │ Image pull
                         ▼
┌─────────────────────────────────────────────────────────────┐
│           Azure Container Apps Environment                  │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  meetifyy-api  (1 replica — required for Socket.IO)  │   │
│  │  • NestJS REST API                                   │   │
│  │  • Socket.IO / WebSocket                             │   │
│  │  • BullMQ workers (email, notifications, match)      │   │
│  │  • Pino logging → Azure Log Analytics                │   │
│  │  PORT 4000, HTTPS via Container Apps ingress         │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────┬──────────────────────────────┘
                               │
           ┌───────────────────┼───────────────────┐
           ▼                   ▼                   ▼
  Supabase PostgreSQL        Redis              Cloudflare R2
  (unchanged)                (unchanged)        (unchanged)
           │
           ▼
  Resend  ·  Sentry  ·  Azure Monitor
```

### Why one Container App instead of two (API + Worker)

The BullMQ workers (`EmailProcessor`, `NotificationsProcessor`,
`InstantMatchProcessor`) are embedded in the same NestJS module graph as the
REST API — there is no separate worker entrypoint. Splitting them would require
creating a new entrypoint and duplicating the entire module graph.

More critically, the Socket.IO gateway uses **in-process state** for presence,
typing indicators, and matching queues. Running a second replica without a
Redis adapter would silently break all real-time features.

For the initial deployment, one Container App at **1 replica** is the correct
architecture. The notes at the end of this guide explain the future path to
horizontal scaling.

---

## 2. Prerequisites

Before starting, you need:

- **Microsoft account** — sign up at https://account.microsoft.com
- **Azure for Students subscription** — see §4 below for activation
- **GitHub account** with push access to this repository
- **Azure CLI** — installed and up to date
- **Docker** (optional — only needed for local image testing)
- **DNS access** to `meetifyy.app` (Cloudflare dashboard)
- Domain `api.meetifyy.app` reserved for the backend

Install the Azure CLI:
```bash
# Linux / WSL
curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash

# macOS
brew install azure-cli

# Verify
az --version
```

---

## 3. Azure Resource Creation

### Resource names used in this guide

| Resource | Name |
|----------|------|
| Resource Group | `meetifyy-rg` |
| Container Registry | `meetifyycr` |
| Container Apps Environment | `meetifyy-env` |
| Container App | `meetifyy-api` |
| Log Analytics Workspace | `meetifyy-logs` |
| Location | `centralindia` (or nearest region) |

> **Cost note:** `centralindia` is one of the cheapest Azure regions. Use
> whatever is geographically closest and available under your subscription.

### 3.1 Login and set subscription

```bash
az login

# List subscriptions and note your ID
az account list --output table

# Set the active subscription
az account set --subscription "YOUR_SUBSCRIPTION_ID"
```

### 3.2 Create Resource Group

```bash
az group create \
  --name meetifyy-rg \
  --location centralindia
```

### 3.3 Create Log Analytics Workspace

Required by the Container Apps Environment for log aggregation.

```bash
az monitor log-analytics workspace create \
  --resource-group meetifyy-rg \
  --workspace-name meetifyy-logs \
  --location centralindia
```

### 3.4 Create Azure Container Registry

```bash
az acr create \
  --resource-group meetifyy-rg \
  --name meetifyycr \
  --sku Basic \
  --admin-enabled false \
  --location centralindia
```

Note the login server:
```bash
az acr show --name meetifyycr --query loginServer --output tsv
# → meetifyycr.azurecr.io
```

### 3.5 Create Container Apps Environment

```bash
# Get the Log Analytics workspace ID and key
WORKSPACE_ID=$(az monitor log-analytics workspace show \
  --resource-group meetifyy-rg \
  --workspace-name meetifyy-logs \
  --query customerId --output tsv)

WORKSPACE_KEY=$(az monitor log-analytics workspace get-shared-keys \
  --resource-group meetifyy-rg \
  --workspace-name meetifyy-logs \
  --query primarySharedKey --output tsv)

# Create the environment
az containerapp env create \
  --name meetifyy-env \
  --resource-group meetifyy-rg \
  --location centralindia \
  --logs-workspace-id "$WORKSPACE_ID" \
  --logs-workspace-key "$WORKSPACE_KEY"
```

### 3.6 Create the meetifyy-api Container App

Run the full create command with placeholder secrets — you will update the
real secret values in §9. Do NOT put real credentials in this command if you
are sharing your terminal history.

```bash
az containerapp create \
  --name meetifyy-api \
  --resource-group meetifyy-rg \
  --environment meetifyy-env \
  --image mcr.microsoft.com/azuredocs/containerapps-helloworld:latest \
  --target-port 4000 \
  --ingress external \
  --transport http \
  --min-replicas 1 \
  --max-replicas 1 \
  --cpu 0.5 \
  --memory 1Gi \
  --registry-server meetifyycr.azurecr.io \
  --env-vars \
    APP_ENV=production \
    NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000 \
    APP_NAME=Meetifyy \
    APP_VERSION=0.9.0 \
    FRONTEND_URL=https://meetifyy.app \
    BACKEND_URL=https://api.meetifyy.app \
    ADMIN_URL=https://admin.meetifyy.app \
    CORS_ORIGINS="https://meetifyy.app,https://www.meetifyy.app" \
    CORS_ORIGIN_PATTERNS="https://*.meetifyy.app" \
    COOKIE_DOMAIN=.meetifyy.app \
    EMAIL_DRIVER=resend \
    EMAIL_FROM=noreply@meetifyy.app \
    EMAIL_FROM_NAME=Meetifyy \
    STORAGE_PROVIDER=r2 \
    CSP_CONNECT_SRC="wss://api.meetifyy.app" \
  --secrets \
    database-url="PLACEHOLDER_REPLACE_ME" \
    direct-url="PLACEHOLDER_REPLACE_ME" \
    redis-url="PLACEHOLDER_REPLACE_ME" \
    supabase-url="PLACEHOLDER_REPLACE_ME" \
    supabase-anon-key="PLACEHOLDER_REPLACE_ME" \
    supabase-service-role-key="PLACEHOLDER_REPLACE_ME" \
    supabase-jwt-secret="PLACEHOLDER_REPLACE_ME" \
    admin-jwt-access-secret="PLACEHOLDER_REPLACE_ME" \
    admin-jwt-refresh-secret="PLACEHOLDER_REPLACE_ME" \
    admin-jwt-pending-secret="PLACEHOLDER_REPLACE_ME" \
    resend-api-key="PLACEHOLDER_REPLACE_ME" \
    r2-access-key-id="PLACEHOLDER_REPLACE_ME" \
    r2-secret-access-key="PLACEHOLDER_REPLACE_ME" \
    sentry-dsn="PLACEHOLDER_REPLACE_ME"
```

After creating the Container App, add the secret-backed environment variables:

```bash
az containerapp update \
  --name meetifyy-api \
  --resource-group meetifyy-rg \
  --set-env-vars \
    "DATABASE_URL=secretref:database-url" \
    "DIRECT_URL=secretref:direct-url" \
    "REDIS_URL=secretref:redis-url" \
    "SUPABASE_URL=secretref:supabase-url" \
    "SUPABASE_ANON_KEY=secretref:supabase-anon-key" \
    "SUPABASE_SERVICE_ROLE_KEY=secretref:supabase-service-role-key" \
    "SUPABASE_JWT_SECRET=secretref:supabase-jwt-secret" \
    "ADMIN_JWT_ACCESS_SECRET=secretref:admin-jwt-access-secret" \
    "ADMIN_JWT_REFRESH_SECRET=secretref:admin-jwt-refresh-secret" \
    "ADMIN_JWT_PENDING_SECRET=secretref:admin-jwt-pending-secret" \
    "RESEND_API_KEY=secretref:resend-api-key" \
    "R2_ACCESS_KEY_ID=secretref:r2-access-key-id" \
    "R2_SECRET_ACCESS_KEY=secretref:r2-secret-access-key" \
    "SENTRY_DSN=secretref:sentry-dsn"
```

---

## 4. Azure for Students

### Activating your student benefit

1. Go to https://azure.microsoft.com/en-us/free/students/
2. Click **Start free** and sign in with your university email
3. Verify your student status (email domain or SheerID)
4. Receive **$100 USD credit** valid for 12 months

### Credit allocation guidance

| Resource | Monthly estimate | Notes |
|----------|-----------------|-------|
| Container Apps (0.5 vCPU / 1 GB) | ~$5–12 USD | Depends on request volume |
| Container Registry Basic | ~$5 USD | Fixed |
| Log Analytics | ~$2–5 USD | Based on log volume |
| **Total** | **~$12–22 USD/month** | Well within $100 credit |

> [!CAUTION]
> Always set a **spending limit / budget alert** immediately after activating.
> Azure for Students does NOT automatically stop services when credit runs out
> on some subscription types. See §21 for budget configuration.

> [!WARNING]
> Do NOT use:
> - Premium or Standard Container Registry tiers (Basic is sufficient)
> - More than 1 replica until Socket.IO is scaled properly
> - Large VM sizes or App Service plans
> - Azure Database for PostgreSQL (stay on Supabase)
> - Azure Cache for Redis unless you migrate off your current Redis provider

---

## 5. Azure CLI Setup

Full authentication and deployment command sequence:

```bash
# 1. Login
az login

# 2. Set subscription
az account set --subscription "YOUR_SUBSCRIPTION_ID"

# 3. Add Container Apps extension
az extension add --name containerapp --upgrade

# 4. Register providers (first-time only)
az provider register --namespace Microsoft.App
az provider register --namespace Microsoft.OperationalInsights

# 5. Verify
az containerapp list --resource-group meetifyy-rg --output table
```

---

## 6. Azure Container Registry

### Building and pushing locally

```bash
# Login to ACR
az acr login --name meetifyycr

# Build the image from the backend directory
docker build \
  --tag meetifyycr.azurecr.io/meetifyy-api:latest \
  --file backend/Dockerfile \
  backend/

# Push
docker push meetifyycr.azurecr.io/meetifyy-api:latest
```

### Grant Container App pull access from ACR

```bash
# Get the Container App's managed identity
PRINCIPAL_ID=$(az containerapp show \
  --name meetifyy-api \
  --resource-group meetifyy-rg \
  --query identity.principalId --output tsv)

# Get the ACR resource ID
ACR_ID=$(az acr show \
  --name meetifyycr \
  --resource-group meetifyy-rg \
  --query id --output tsv)

# Grant AcrPull to the Container App
az role assignment create \
  --assignee "$PRINCIPAL_ID" \
  --role AcrPull \
  --scope "$ACR_ID"
```

---

## 7. Container App Configuration

### CPU and Memory

For a student project, start with:

```
--cpu 0.5
--memory 1Gi
```

The NestJS process + BullMQ workers comfortably run in 512 MB. Scale to
`--cpu 1.0 --memory 2Gi` only if you see OOM restarts.

### Ingress

```bash
az containerapp ingress show \
  --name meetifyy-api \
  --resource-group meetifyy-rg
```

The container is exposed on port 4000 with external HTTPS ingress. Azure
handles TLS termination automatically.

### Replicas

```
--min-replicas 1
--max-replicas 1
```

**This is intentional.** The Socket.IO gateway uses in-process state. Scaling
to 2+ replicas will cause clients on different replicas to be invisible to each
other — presence, typing indicators, and instant matching will silently break.

To scale horizontally in the future:
1. Add `@socket.io/redis-adapter` and connect it to the Redis instance
2. Ensure all Socket.IO state (rooms, presence) goes through Redis
3. Test multi-instance behaviour thoroughly in staging

### Health probes

Container Apps will probe `GET /health` (returns `{"status":"ok","timestamp":"..."}`)

```bash
az containerapp ingress update \
  --name meetifyy-api \
  --resource-group meetifyy-rg \
  --target-port 4000
```

Configure health probes via the portal or bicep:
- **Startup probe**: `GET /health`, initial delay 20s, period 10s, failure threshold 6
- **Liveness probe**: `GET /health`, period 30s, failure threshold 3
- **Readiness probe**: `GET /health`, period 10s, failure threshold 3

### WebSocket / Socket.IO

Azure Container Apps supports WebSockets natively over HTTPS ingress. No
additional configuration is needed beyond setting `--transport http`.
Socket.IO will negotiate the transport automatically.

### HTTPS

Azure Container Apps automatically provisions and renews a TLS certificate for
the default `*.azurecontainerapps.io` FQDN. For the custom domain
`api.meetifyy.app`, see §14.

---

## 8. Worker Configuration

All BullMQ workers run inside the same Container App as the API. They are:

| Queue | Processor | Purpose |
|-------|-----------|---------|
| `email` | `EmailProcessor` | Send transactional email via Resend |
| `notifications` | `NotificationsProcessor` | Create follow/invite notifications |
| `instant-match` | `InstantMatchProcessor` | Expire stale match sessions |

No additional configuration is needed. Workers start automatically when the
NestJS application bootstraps. They connect to Redis using the same
`REDIS_URL` as the main process.

**Worker scaling**: Workers scale with the API replica count. Since you must
hold at 1 replica for Socket.IO correctness, workers naturally also stay at 1.
This is fine — BullMQ workers at 1 concurrency process one job at a time,
which is sufficient for typical notification and email volumes.

**Monitoring workers**: Worker job failures are logged via Pino and visible in
Azure Log Analytics. Job failure records (up to 100) are stored in Redis.

---

## 9. Environment Variables

Replace every `YOUR_*` placeholder with your actual values before deploying.

### Updating secrets after initial creation

```bash
az containerapp secret set \
  --name meetifyy-api \
  --resource-group meetifyy-rg \
  --secrets \
    "database-url=YOUR_DATABASE_URL" \
    "direct-url=YOUR_DIRECT_URL" \
    "redis-url=YOUR_REDIS_URL" \
    "supabase-url=YOUR_SUPABASE_URL" \
    "supabase-anon-key=YOUR_SUPABASE_ANON_KEY" \
    "supabase-service-role-key=YOUR_SUPABASE_SERVICE_ROLE_KEY" \
    "supabase-jwt-secret=YOUR_SUPABASE_JWT_SECRET" \
    "admin-jwt-access-secret=YOUR_ADMIN_JWT_ACCESS_SECRET" \
    "admin-jwt-refresh-secret=YOUR_ADMIN_JWT_REFRESH_SECRET" \
    "admin-jwt-pending-secret=YOUR_ADMIN_JWT_PENDING_SECRET" \
    "resend-api-key=YOUR_RESEND_API_KEY" \
    "r2-access-key-id=YOUR_R2_ACCESS_KEY_ID" \
    "r2-secret-access-key=YOUR_R2_SECRET_ACCESS_KEY" \
    "sentry-dsn=YOUR_SENTRY_DSN"
```

### Complete environment variable reference

| Variable | Required | Secret | Source | Purpose |
|----------|----------|--------|--------|---------|
| `APP_ENV` | ✅ | No | Set directly | Must be `production` |
| `NODE_ENV` | ✅ | No | Set directly | Must be `production` |
| `HOST` | No | No | Default `0.0.0.0` | Bind address |
| `PORT` | No | No | Default `4000` | HTTP port |
| `APP_NAME` | No | No | Default `Meetifyy` | Display name |
| `APP_VERSION` | No | No | Default `0.9.0` | Version string |
| `FRONTEND_URL` | ✅ | No | `https://meetifyy.app` | CORS + email links |
| `BACKEND_URL` | ✅ | No | `https://api.meetifyy.app` | Self-reference |
| `ADMIN_URL` | No | No | `https://admin.meetifyy.app` | CORS admin |
| `CORS_ORIGINS` | No | No | Comma list | Extra CORS origins |
| `CORS_ORIGIN_PATTERNS` | No | No | `https://*.meetifyy.app` | Wildcard CORS |
| `COOKIE_DOMAIN` | No | No | `.meetifyy.app` | Auth cookies |
| `COOKIE_SECURE` | No | No | Default `true` in prod | Cookie security |
| `COOKIE_SAME_SITE` | No | No | Default `strict` | Cookie SameSite |
| `DATABASE_URL` | ✅ | ✅ | Supabase dashboard | Pooled DB URL |
| `DIRECT_URL` | No | ✅ | Supabase dashboard | Unpooled for migrations |
| `SUPABASE_URL` | ✅ | No | Supabase project | Supabase project URL |
| `SUPABASE_ANON_KEY` | ✅ | ✅ | Supabase dashboard | Public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | ✅ | Supabase dashboard | Bypasses RLS |
| `SUPABASE_JWT_SECRET` | No | ✅ | Supabase dashboard | JWT verification |
| `SUPABASE_BUCKET_NAME` | No | No | Default `meetifyy-dev` | Storage bucket |
| `ADMIN_JWT_ACCESS_SECRET` | ✅ | ✅ | Generated | Admin access token |
| `ADMIN_JWT_REFRESH_SECRET` | ✅ | ✅ | Generated | Admin refresh token |
| `ADMIN_JWT_PENDING_SECRET` | ✅ | ✅ | Generated | Admin pending token |
| `SUPER_ADMIN_EMAIL` | No | No | You | Super admin login |
| `SUPER_ADMIN_PASSWORD` | No | ✅ | Generated | Super admin password |
| `SUPER_ADMIN_API_KEY` | No | ✅ | Generated | Machine API access |
| `REDIS_URL` | No | ✅ | Redis provider | Redis connection |
| `REDIS_HOST` | No | No | Default `127.0.0.1` | Alt to REDIS_URL |
| `REDIS_PORT` | No | No | Default `6379` | Alt to REDIS_URL |
| `REDIS_PASSWORD` | No | ✅ | Redis provider | Alt to REDIS_URL |
| `REDIS_TLS` | No | No | `true` if rediss:// | TLS for Redis |
| `REDIS_QUEUE_PREFIX` | No | No | Default `bull:production` | BullMQ namespace |
| `EMAIL_DRIVER` | No | No | `resend` | Email provider |
| `EMAIL_FROM` | ✅ | No | `noreply@meetifyy.app` | Sender address |
| `EMAIL_FROM_NAME` | No | No | `Meetifyy` | Sender name |
| `RESEND_API_KEY` | ✅ | ✅ | resend.com | Resend API key |
| `STORAGE_PROVIDER` | No | No | `r2` | Storage backend |
| `STORAGE_PUBLIC_URL` | No | No | `https://cdn.meetifyy.app` | CDN URL |
| `R2_ACCOUNT_ID` | No | No | Cloudflare dashboard | R2 account |
| `R2_ACCESS_KEY_ID` | No | ✅ | Cloudflare dashboard | R2 access key |
| `R2_SECRET_ACCESS_KEY` | No | ✅ | Cloudflare dashboard | R2 secret |
| `R2_BUCKET_NAME` | No | No | `meetifyy-prod` | R2 bucket name |
| `R2_VERIFICATION_BUCKET_NAME` | No | No | _(unset)_ | Private bucket for account-verification documents. Must have **no public access** — no `r2.dev` URL, no custom domain. Unset falls back to `R2_BUCKET_NAME`, whose public host serves any key without authentication. |
| `R2_PUBLIC_URL` | No | No | `https://cdn.meetifyy.app` | R2 public URL |
| `SENTRY_DSN` | No | ✅ | sentry.io | Sentry reporting |
| `SENTRY_TRACES_SAMPLE_RATE` | No | No | Default `0.1` | Sentry traces |
| `SENTRY_PROFILES_SAMPLE_RATE` | No | No | Default `0.05` | Sentry profiles |
| `LOG_LEVEL` | No | No | Default `info` | Pino log level |
| `LOG_PRETTY` | No | No | Default `false` | Human log format |
| `CSP_CONNECT_SRC` | No | No | `wss://api.meetifyy.app` | CSP WebSocket |
| `CSP_ENABLED` | No | No | Default `true` in prod | Security headers |
| `HSTS_ENABLED` | No | No | Default `true` in prod | HSTS header |

Generate strong random secrets:
```bash
# For each JWT secret:
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

---

## 10. Supabase

The existing Supabase PostgreSQL database connects from Azure Container Apps
via connection strings in `DATABASE_URL` and `DIRECT_URL`.

### Connection strings from Supabase dashboard

1. Open your Supabase project
2. Go to **Settings → Database**
3. Under **Connection string**, select **URI** mode
4. Copy both:
   - **Session mode** (port 5432) → `DIRECT_URL` (used for migrations)
   - **Transaction mode** (port 6543, Supavisor) → `DATABASE_URL` (used by the app)

The backend uses `@prisma/adapter-pg` with a connection pool. No changes to
Prisma configuration are needed for Azure.

### Prisma considerations

- `prisma generate` runs during the Docker build (Dockerfile stage 2 and 3)
- `prisma migrate deploy` runs as a GitHub Actions step before the new image is deployed
- The Prisma client uses the `PrismaPg` adapter (node-postgres), which works
  correctly with Supabase's transaction pooler without the prepared statement
  issues that affect the native Rust driver

### Whitelisting Azure IPs (if needed)

Supabase allows connections from any IP by default. If you enable IP allowlisting
on your Supabase project, you need to add the Azure Container Apps outbound IPs.
Get them with:
```bash
az containerapp env show \
  --name meetifyy-env \
  --resource-group meetifyy-rg \
  --query properties.staticIp --output tsv
```

---

## 11. Cloudflare R2

Cloudflare R2 is accessed as an S3-compatible API from wherever the backend runs.
No configuration changes are required for Azure.

The backend reads these variables:
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`, `R2_PUBLIC_URL`

Set them as Container App secrets and reference them as `secretref:r2-access-key-id` etc.

> [!NOTE]
> Azure Container Apps does NOT have an ephemeral local
> filesystem that is wiped on deploy. However, local disk storage is still
> not used in production — all uploads go directly to R2.

---

## 12. Resend

Resend sends email over HTTPS from any network — no special firewall rules
needed. The backend connects to `api.resend.com` on port 443.

Set `EMAIL_DRIVER=resend` and `RESEND_API_KEY` (as a secret).

The `EMAIL_FROM` domain (`meetifyy.app`) must be verified in the Resend
dashboard with SPF, DKIM, and DMARC records published. These are independent
of the hosting platform.

---

## 13. Sentry

Sentry reports errors over HTTPS from any network. No changes are needed.

Set `SENTRY_DSN` as a secret. The backend initialises Sentry before NestJS
bootstraps (in `main.ts`), so all startup errors are captured.

**Azure + Sentry division of responsibility:**
- Sentry: application errors, exceptions, traces, profiles
- Azure Monitor / Log Analytics: container health, infrastructure metrics, deployment logs

---

## 14. Custom Domain

### Add api.meetifyy.app to the Container App

```bash
# 1. Get the Container App's default domain
az containerapp show \
  --name meetifyy-api \
  --resource-group meetifyy-rg \
  --query properties.configuration.ingress.fqdn --output tsv
# Returns something like: meetifyy-api.livelybeach-abc123.centralindia.azurecontainerapps.io

# 2. Add the custom domain (requires DNS verification first)
az containerapp hostname add \
  --name meetifyy-api \
  --resource-group meetifyy-rg \
  --hostname api.meetifyy.app

# 3. Bind a managed certificate
az containerapp hostname bind \
  --name meetifyy-api \
  --resource-group meetifyy-rg \
  --hostname api.meetifyy.app \
  --environment meetifyy-env \
  --validation-method CNAME
```

### DNS record (Cloudflare)

In the Cloudflare dashboard for `meetifyy.app`:

| Type | Name | Content | Proxy |
|------|------|---------|-------|
| CNAME | `api` | `meetifyy-api.livelybeach-abc123.centralindia.azurecontainerapps.io` | **DNS only** (grey ☁) at first — see below |

Replace the `Content` value with your actual Container App FQDN. It must be a
**CNAME to the Azure FQDN**. An `A` record holding a Cloudflare IP produces
Cloudflare **Error 1000 — "DNS points to prohibited IP"**, which is what the
`dev-api` record was doing while DEV was down.

> [!IMPORTANT]
> **Order matters.** Add the record as **DNS only (grey cloud)** first, and
> leave it there until Azure has issued and bound the managed certificate.
> The binding is `SniEnabled`, and Cloudflare's proxy terminates TLS itself,
> so validation cannot complete while the record is proxied.
>
> 1. Add the CNAME, **DNS only**.
> 2. Bind the custom domain in Azure and wait for the managed certificate.
> 3. Confirm `curl https://api.meetifyy.app/health` returns 200.
> 4. *Then* switch to **Proxied (orange cloud)** if you want it, and set
>    SSL/TLS mode to **Full (strict)** so Cloudflare speaks HTTPS to Azure.
>
> Proxying is worth enabling once it works: it hides the Azure IP, adds DDoS
> protection, and helps on college networks that block Azure IP ranges — see
> [docs/network-reachability.md](docs/network-reachability.md). Just do not
> turn it on before step 3, or you cannot tell a certificate problem from a
> proxy problem.

### HTTPS

Azure Container Apps automatically provisions a TLS certificate for
`api.meetifyy.app` once the CNAME is in place. The certificate renews
automatically. No configuration needed beyond adding the custom domain.

### CORS

CORS is configured via environment variables. For production, ensure:

```
FRONTEND_URL=https://meetifyy.app
ADMIN_URL=https://admin.meetifyy.app
CORS_ORIGINS=https://meetifyy.app,https://www.meetifyy.app
CORS_ORIGIN_PATTERNS=https://*.meetifyy.app
```

The backend's CORS middleware automatically includes `FRONTEND_URL` and
`ADMIN_URL` in the allowed origins — you do not need to repeat them in
`CORS_ORIGINS`.

---

## 15. Frontend Configuration

### Vercel environment variables (Production scope)

| Variable | Value |
|----------|-------|
| `VITE_API_URL` | `https://api.meetifyy.app` |
| `VITE_SITE_URL` | `https://meetifyy.app` |

Set these in: Vercel dashboard → Project → Settings → Environment Variables →
select **Production** scope.

### WebSocket URL

The frontend's Socket.IO client constructs the WebSocket URL from `VITE_API_URL`.
No separate WebSocket variable is needed — `https://api.meetifyy.app` is used
directly (Socket.IO negotiates the transport and upgrades to WebSocket
automatically).

### vercel.json rewrites

The `/_api/:path*` rewrite in `vercel.json` already points to
`https://api.meetifyy.app`. This is the same-origin failover for networks that
block direct API access. No changes are needed.

### After updating Vercel env vars

Trigger a redeployment so the new build picks up the updated variables:
```bash
# In the repository root
npx vercel --prod
# or push a commit to the production branch
```

---

## 16. GitHub Actions

### Deployment flow

```
Push to main
  ↓
.github/workflows/azure-deploy.yml triggers
  ↓
Azure login via OIDC (no stored password)
  ↓
docker build backend/Dockerfile → meetifyycr.azurecr.io/meetifyy-api:<sha>
  ↓
docker push to ACR
  ↓
az containerapp job (run prisma migrate deploy)
  ↓
az containerapp update (deploy new image)
  ↓
Health check GET /health
```

### One-time OIDC setup (recommended — most secure)

```bash
# 1. Create a service principal
az ad sp create-for-rbac \
  --name meetifyy-github-actions \
  --role Contributor \
  --scopes /subscriptions/YOUR_SUBSCRIPTION_ID/resourceGroups/meetifyy-rg \
  --json-auth

# 2. Note the appId (clientId) and tenant

# 3. Add federated credentials.
#    The deploy workflows declare `environment:`, which makes GitHub mint the
#    OIDC token with subject `environment:<name>` rather than
#    `ref:refs/heads/<branch>`. Register the environment form or every deploy
#    fails at "Azure login" with AADSTS700213. Both are registered so the
#    workflow still authenticates if `environment:` is ever dropped.
az ad app federated-credential create \
  --id YOUR_APP_ID \
  --parameters '{
    "name": "meetifyy-prod-environment",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:YOUR_GITHUB_ORG/meetifyy:environment:production",
    "audiences": ["api://AzureADTokenExchange"]
  }'

az ad app federated-credential create \
  --id YOUR_APP_ID \
  --parameters '{
    "name": "meetifyy-main",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:YOUR_GITHUB_ORG/meetifyy:ref:refs/heads/main",
    "audiences": ["api://AzureADTokenExchange"]
  }'

# 4. Grant ACR push permission
ACR_ID=$(az acr show --name meetifyycr --query id --output tsv)
az role assignment create \
  --assignee YOUR_APP_ID \
  --role AcrPush \
  --scope "$ACR_ID"
```

### GitHub Actions secrets

Go to: GitHub → Repository → Settings → Secrets and variables → Actions

| Secret name | Value |
|-------------|-------|
| `AZURE_CLIENT_ID` | Service principal app (client) ID |
| `AZURE_TENANT_ID` | Azure tenant ID |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription ID |
| `ACR_LOGIN_SERVER` | `meetifyycr.azurecr.io` |
| `AZURE_RESOURCE_GROUP` | `meetifyy-rg` |
| `AZURE_CONTAINERAPP_NAME` | `meetifyy-api` |

> [!CAUTION]
> Never commit Azure credentials to the repository. The OIDC approach above
> stores no password anywhere — the federated credential is the only link.

### Manual deployment

To deploy without GitHub Actions (e.g., from your local machine):

```bash
az login
az acr login --name meetifyycr
docker build -t meetifyycr.azurecr.io/meetifyy-api:manual backend/ -f backend/Dockerfile
docker push meetifyycr.azurecr.io/meetifyy-api:manual
az containerapp update \
  --name meetifyy-api \
  --resource-group meetifyy-rg \
  --image meetifyycr.azurecr.io/meetifyy-api:manual
```

---

## 17. Local Development

Local development is **unchanged**. The Docker/Azure setup is only for
production deployment. Locally, the backend runs directly with Node.js.

### Setup

```bash
# Root of the monorepo
npm install

# Copy and fill in backend env
cp backend/.env.example backend/.env.local
# Edit backend/.env.local with your local values

# Copy and fill in frontend env
cp frontend/.env.example frontend/.env.local
# Edit frontend/.env.local
```

### Scripts (from package.json)

```bash
# Start all services (backend + frontend dev server)
npm run dev

# Backend only — applies migrations then starts with watch/reload
cd backend && npm run start:dev

# Production build
cd backend && npm run build

# Run production bundle locally
cd backend && npm run start:prod

# Prisma operations
cd backend && npm run prisma:migrate     # local dev migration
cd backend && npx prisma migrate deploy  # apply to target DB

# Tests
cd backend && npm test
cd backend && npm run test:e2e
```

---

## 18. Verification Checklist

After deploying, verify each item:

```
[ ] GET https://api.meetifyy.app/health returns {"status":"ok",...}
[ ] Authentication: POST /auth/login returns a session cookie
[ ] Database: user data is readable (no Prisma connection errors in logs)
[ ] Prisma migrations: az containerapp logs show no migration errors
[ ] Redis: BullMQ queue processing — send a test email
[ ] Email: a test registration triggers a welcome email via Resend
[ ] R2 uploads: upload a profile photo, verify it appears in the feed
[ ] Socket.IO: open the frontend, check presence (green dot) is visible
[ ] Presence: open two browser tabs — status shows Online in the other
[ ] Chat: send a message in DM — it arrives in real-time
[ ] Typing indicator: start typing — indicator appears in the other tab
[ ] Instant match: enter the match queue and verify join/leave events
[ ] Notifications: follow a user — notification appears in real-time
[ ] CORS: verify no CORS errors in browser console on the frontend
[ ] HTTPS: certificate is valid for api.meetifyy.app (green padlock)
[ ] Custom domain: api.meetifyy.app resolves to the Container App
[ ] Sentry: trigger a 500 error — verify it appears in Sentry dashboard
[ ] Logs: az containerapp logs show --name meetifyy-api --follow shows JSON lines
[ ] Frontend: meetifyy.app loads and connects to the new API
```

---

## 19. Troubleshooting

### Container won't start

```bash
# Check recent logs
az containerapp logs show \
  --name meetifyy-api \
  --resource-group meetifyy-rg \
  --follow

# Check revision status
az containerapp revision list \
  --name meetifyy-api \
  --resource-group meetifyy-rg \
  --output table
```

**Common cause**: Missing required environment variable. Check the log for
`Environment configuration is invalid` — it lists every problem.

---

### Prisma / database connection failure

Log line: `Could not connect to database on startup.`

1. Verify `DATABASE_URL` is set correctly (transaction pooler, port 6543)
2. Verify `DIRECT_URL` is set for migrations (direct connection, port 5432)
3. Check Supabase project is not paused (free tier pauses after 7 days inactive)
4. If using IP allowlisting: add the Container Apps environment static IP

---

### Redis connection failure

Log line: `REDIS_URL not configured` or repeated `Cloud connection limit reached`

1. Verify `REDIS_URL` is set (format: `redis://user:pass@host:port` or `rediss://...`)
2. Check the Redis service is running
3. Verify TLS: if the URL is `rediss://`, the backend enables TLS automatically
4. The app is designed to degrade gracefully without Redis — BullMQ jobs will
   fail to enqueue, but REST API calls will still work

---

### BullMQ worker not processing jobs

1. Check logs for `Bull queue connection` errors
2. Verify `REDIS_URL` is correct
3. Check `REDIS_QUEUE_PREFIX` matches between API and any debugging tools
   (default: `bull:production` in production)
4. Jobs pile up in the queue and process when Redis reconnects — no data loss

---

### Socket.IO connection failure

Browser console: `WebSocket connection failed` or `CORS error`

1. Verify `CORS_ORIGINS` includes the frontend origin
2. Verify `FRONTEND_URL` is set correctly
3. Try forcing long-polling: the Socket.IO client falls back automatically
4. Check that the Container App ingress supports WebSocket upgrades
   (`--transport http` must be set, not `--transport http2`)

---

### CORS errors

Browser console: `Access-Control-Allow-Origin` error

1. Verify `FRONTEND_URL=https://meetifyy.app` (exact match, no trailing slash)
2. Verify `ADMIN_URL=https://admin.meetifyy.app`
3. Add any additional origins to `CORS_ORIGINS`
4. Wildcard subdomains: use `CORS_ORIGIN_PATTERNS=https://*.meetifyy.app`

---

### R2 upload failures

Log: `R2 upload failed` or `NoSuchBucket`

1. Verify `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
2. Verify `R2_BUCKET_NAME` matches the actual bucket name
3. Check the R2 API token has `Object Read & Write` permissions
4. `STORAGE_PROVIDER` must be `r2` (not `local` or `supabase`)

---

### Resend failures

Log: `domain is not verified` or email jobs failing

1. Verify `EMAIL_DRIVER=resend`
2. Verify `RESEND_API_KEY` is valid
3. Verify `EMAIL_FROM` uses a domain verified in Resend (SPF/DKIM published)
4. Check the Resend dashboard for delivery errors

---

### Environment variable problems

The backend validates all environment variables at startup and logs every
problem at once:

```bash
az containerapp logs show --name meetifyy-api --resource-group meetifyy-rg \
  | grep "Environment configuration is invalid"
```

This will show a list like:
```
• Missing required environment variable: DATABASE_URL
• Missing required environment variable: FRONTEND_URL
```

---

### Health probe failures

Container Apps marks a revision unhealthy if `/health` doesn't respond.

1. Verify the app starts — check logs for `Bootstrap` success message
2. Verify `PORT=4000` matches `--target-port 4000`
3. The startup probe has a 20s grace period — wait before concluding it's broken
4. OOM kills: increase memory from 1Gi to 2Gi

---

### Container crashes / OOM

```bash
az containerapp revision show \
  --name meetifyy-api \
  --resource-group meetifyy-rg \
  --revision REVISION_NAME
```

Look for `reason: OOMKilled`. If present, increase memory:
```bash
az containerapp update \
  --name meetifyy-api \
  --resource-group meetifyy-rg \
  --memory 2Gi \
  --cpu 1.0
```

---

### GitHub Actions deployment failures

**ACR authentication failure**:
- Verify `ACR_LOGIN_SERVER` is exactly `meetifyycr.azurecr.io`
- Verify the service principal has `AcrPush` role on the registry

**OIDC authentication failure** (`AADSTS700213: No matching federated identity
record found for presented assertion subject ...`):
- Read the subject quoted in the error and register **that exact string**.
- A job with `environment: <name>` presents
  `repo:OWNER/REPO:environment:<name>` — *not* the branch subject. Matching
  the branch name is not sufficient and is the usual cause of this error.
- List what is actually registered:
  `az ad app federated-credential list --id <APP_ID> --query "[].{name:name,subject:subject}" -o table`
- Check `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`
- The failure happens *before* the build, so the Container App keeps serving
  its previous image — on a new setup, the placeholder hello-world one.

**Migration job fails**:
- The workflow creates a one-shot Container App Job to run migrations
- Check the job logs: Azure portal → Container Apps → Jobs

---

### Azure Container Registry authentication failures

```bash
# Re-login
az acr login --name meetifyycr

# Verify pull access
az role assignment list \
  --assignee $(az containerapp show --name meetifyy-api \
    --resource-group meetifyy-rg --query identity.principalId --output tsv) \
  --output table
```

---

## 20. Rollback

To roll back to any previous revision:

```bash
# List all revisions
az containerapp revision list \
  --name meetifyy-api \
  --resource-group meetifyy-rg \
  --output table

# Activate a previous revision
az containerapp revision activate \
  --name meetifyy-api \
  --resource-group meetifyy-rg \
  --revision REVISION_NAME

# Send 100% of traffic to the previous revision
az containerapp ingress traffic set \
  --name meetifyy-api \
  --resource-group meetifyy-rg \
  --revision-weight REVISION_NAME=100
```

Or redeploy a specific image tag:
```bash
az containerapp update \
  --name meetifyy-api \
  --resource-group meetifyy-rg \
  --image meetifyycr.azurecr.io/meetifyy-api:SHORT_SHA_OF_GOOD_BUILD
```

Every push to `main` tags the image with the Git short SHA (8 chars). All
pushed images are retained in ACR until you explicitly delete them, so any
previous build can be redeployed.

---

## 21. Cost Protection

### Set a budget alert immediately

```bash
az consumption budget create \
  --budget-name meetifyy-monthly \
  --amount 30 \
  --time-grain Monthly \
  --start-date 2026-01-01 \
  --end-date 2027-01-01 \
  --resource-group meetifyy-rg \
  --notifications '[
    {
      "enabled": true,
      "operator": "GreaterThan",
      "threshold": 50,
      "contactEmails": ["YOUR_EMAIL@example.com"],
      "thresholdType": "Actual"
    },
    {
      "enabled": true,
      "operator": "GreaterThan",
      "threshold": 80,
      "contactEmails": ["YOUR_EMAIL@example.com"],
      "thresholdType": "Actual"
    }
  ]'
```

### Resources that incur cost

| Resource | Cost driver | Mitigation |
|----------|-------------|------------|
| Container Apps | CPU + memory × uptime | Min 1 replica needed; use 0.5 vCPU / 1Gi |
| Container Registry Basic | Fixed ~$5/month | Basic tier is sufficient |
| Log Analytics | Data ingestion GB | Set `LOG_LEVEL=warn` in production to reduce volume |
| ACR storage | Image storage | Prune old images regularly |

### Prune old ACR images

```bash
# Delete images older than 30 days
az acr run \
  --registry meetifyycr \
  --cmd "acr purge --filter 'meetifyy-api:.*' --ago 30d --untagged" \
  /dev/null
```

### Stop resources when not needed (student projects)

If this is a demo or development deployment that doesn't need to run 24/7:

```bash
# Scale to 0 replicas (stops billing for compute)
az containerapp update \
  --name meetifyy-api \
  --resource-group meetifyy-rg \
  --min-replicas 0 \
  --max-replicas 1

# Scale back up
az containerapp update \
  --name meetifyy-api \
  --resource-group meetifyy-rg \
  --min-replicas 1 \
  --max-replicas 1
```

> [!WARNING]
> `min-replicas 0` means the app scales to zero when there's no traffic.
> Cold start after zero-scaling takes 15–30 seconds. Do NOT use this for a
> production deployment where responsiveness matters. For a demo it's fine.

---

## 22. Final Production Architecture

```
                    ┌──────────────────────────┐
                    │   Vercel (Frontend)       │
                    │   meetifyy.app            │
                    │   dev.meetifyy.app        │
                    └───────────┬──────────────┘
                                │ HTTPS + WebSocket
                                │ (via Cloudflare proxy)
                    ┌───────────▼──────────────┐
                    │   Cloudflare             │
                    │   api.meetifyy.app CNAME │
                    └───────────┬──────────────┘
                                │ HTTPS (TLS terminated by Azure)
                    ┌───────────▼──────────────────────────────────┐
                    │   Azure Container Apps                        │
                    │   meetifyy-env (centralindia)                 │
                    │                                               │
                    │   ┌──────────────────────────────────────┐   │
                    │   │  meetifyy-api  (1 replica)           │   │
                    │   │  ┌────────────┐  ┌────────────────┐  │   │
                    │   │  │ NestJS API │  │ BullMQ Workers │  │   │
                    │   │  │ REST + WS  │  │ email          │  │   │
                    │   │  │ Socket.IO  │  │ notifications  │  │   │
                    │   │  │ Pino logs  │  │ instant-match  │  │   │
                    │   │  └────────────┘  └────────────────┘  │   │
                    │   └──────────────────────────────────────┘   │
                    └──────────────┬────────────────────────────────┘
                                   │
          ┌──────────────┬─────────┴────────────┬────────────────┐
          ▼              ▼                       ▼                ▼
  ┌──────────────┐ ┌──────────┐         ┌──────────────┐ ┌────────────┐
  │  Supabase    │ │  Redis   │         │ Cloudflare   │ │  Resend    │
  │  PostgreSQL  │ │  BullMQ  │         │ R2 Storage   │ │  Email     │
  │  (unchanged) │ │  presence│         │  (unchanged) │ │(unchanged) │
  └──────────────┘ └──────────┘         └──────────────┘ └────────────┘
          │
  ┌───────▼──────────────────────────────────────────────────────────┐
  │  Observability                                                    │
  │  Sentry (errors/traces)  ·  Azure Monitor (infra/logs)           │
  └──────────────────────────────────────────────────────────────────┘
```

### Future horizontal scaling path

When traffic grows and Socket.IO must scale beyond 1 replica:

1. Add `@socket.io/redis-adapter` to the NestJS WebSocket gateway
2. Configure it using the existing `REDIS_URL`
3. Ensure presence, typing state, and match queues go through Redis
4. Test with 2 replicas in staging
5. Increase `--max-replicas` in the Container App configuration

This is a NestJS code change, not an infrastructure change — the Azure setup
described here already supports multiple replicas once the adapter is in place.
---

## 23. Development and Production Workflow

This section describes the complete two-environment architecture: how the
`development` branch maps to a DEV environment and `main` maps to PRODUCTION,
how Prisma migrations flow safely between them, and how secrets are isolated.

---

### 23.1 Principle: One Codebase, Two Environments

```
                        GitHub Repository
                        (single codebase)
                               │
               ┌───────────────┴───────────────┐
               │                               │
        development branch                  main branch
               │                               │
               ▼                               ▼
          Azure DEV                       Azure PROD
       (meetifyy-dev-rg)              (meetifyy-prod-rg)
               │                               │
        ┌──────┴──────┐                 ┌──────┴──────┐
        │             │                 │             │
  meetifyy-api-dev    │           meetifyy-api        │
  (Container App)     │           (Container App)     │
        │             │                 │             │
        ▼             ▼                 ▼             ▼
  Supabase DEV    DEV Redis       Supabase PROD   PROD Redis
  PostgreSQL      DEV R2          PostgreSQL      PROD R2
                  DEV Resend                      PROD Resend
```

**The rule:** The application code is identical in both environments. The only
differences are environment variables, secrets, and the databases they point to.

---

### 23.2 Git Branch Strategy

| Branch | Deploys to | Database | Purpose |
|--------|-----------|----------|---------|
| `development` | Azure DEV | Supabase DEV | Feature development, integration testing |
| `main` | Azure PROD | Supabase PROD | Live production application |
| `feature/*` | — (CI only) | — | Individual feature work, PR target: `development` |

**Never push directly to `main`.** The correct path is:

```
feature branch
  → pull request → development
      → development deploy → DEV testing
          → pull request → main
              → production deploy → production testing
```

`main` should be a [protected branch](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) in GitHub:
- Require PR reviews before merging
- Require CI status checks to pass
- Restrict who can push directly

---

### 23.3 GitHub Actions Workflows

Three workflow files implement this architecture:

| File | Trigger | Purpose |
|------|---------|---------|
| [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | PR to `development` or `main` | Lint, typecheck, Prisma schema validate, build, tests |
| [`.github/workflows/deploy-dev.yml`](.github/workflows/deploy-dev.yml) | Push to `development` | Build `dev-<sha>` image, migrate DEV DB, deploy to DEV |
| [`.github/workflows/deploy-prod.yml`](.github/workflows/deploy-prod.yml) | Push to `main` | Build `prod-<sha>` image, migrate PROD DB, deploy to PROD |

#### GitHub Environments for secret isolation

Create two GitHub Environments in your repository settings:

**Settings → Environments → New environment → `development`**
- Add the DEV-only secrets listed below
- Optionally: no required reviewers (fast dev iterations)

**Settings → Environments → New environment → `production`**
- Add the PROD-only secrets listed below
- **Recommended:** Require 1 reviewer before deployment runs

Secrets in the `development` environment are **never visible** to a job running
in the `production` environment, and vice versa. This is enforced by GitHub.

#### Development environment secrets

| Secret | Value |
|--------|-------|
| `AZURE_CLIENT_ID_DEV` | DEV service principal app (client) ID |
| `AZURE_TENANT_ID` | Azure AD tenant ID (shared) |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription ID (shared) |
| `ACR_LOGIN_SERVER` | `meetifyycr.azurecr.io` (shared registry) |
| `AZURE_RESOURCE_GROUP_DEV` | `meetifyy-dev-rg` |
| `AZURE_CONTAINERAPP_DEV` | `meetifyy-api-dev` |

#### Production environment secrets

| Secret | Value |
|--------|-------|
| `AZURE_CLIENT_ID_PROD` | PROD service principal app (client) ID |
| `AZURE_TENANT_ID` | Azure AD tenant ID (shared) |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription ID (shared) |
| `ACR_LOGIN_SERVER` | `meetifyycr.azurecr.io` (shared registry) |
| `AZURE_RESOURCE_GROUP_PROD` | `meetifyy-prod-rg` |
| `AZURE_CONTAINERAPP_PROD` | `meetifyy-api` |

> [!CAUTION]
> **Database credentials are NOT GitHub secrets.** `DATABASE_URL` and
> `DIRECT_URL` are stored as secrets on the Azure Container App itself. The
> migration job reads them from the Container App's secret store at runtime.
> They never appear in GitHub Actions environment variables, workflow logs, or
> repository settings. This is the architecture that prevents the production
> database URL from ever being accessible to a development workflow run.

---

### 23.4 Azure Resources: DEV vs PROD

Create completely separate Azure resource groups for each environment.

#### DEV resources

```bash
# Resource Group
az group create --name meetifyy-dev-rg --location centralindia

# Log Analytics (DEV)
az monitor log-analytics workspace create \
  --resource-group meetifyy-dev-rg \
  --workspace-name meetifyy-dev-logs \
  --location centralindia

# Container Apps Environment (DEV)
az containerapp env create \
  --name meetifyy-dev-env \
  --resource-group meetifyy-dev-rg \
  --location centralindia \
  --logs-workspace-id "$(az monitor log-analytics workspace show \
      --resource-group meetifyy-dev-rg \
      --workspace-name meetifyy-dev-logs \
      --query customerId --output tsv)" \
  --logs-workspace-key "$(az monitor log-analytics workspace get-shared-keys \
      --resource-group meetifyy-dev-rg \
      --workspace-name meetifyy-dev-logs \
      --query primarySharedKey --output tsv)"

# Container App (DEV)
az containerapp create \
  --name meetifyy-api-dev \
  --resource-group meetifyy-dev-rg \
  --environment meetifyy-dev-env \
  --image mcr.microsoft.com/azuredocs/containerapps-helloworld:latest \
  --target-port 4000 \
  --ingress external \
  --transport http \
  --min-replicas 1 \
  --max-replicas 1 \
  --cpu 0.5 \
  --memory 1Gi \
  --registry-server meetifyycr.azurecr.io \
  --env-vars \
    APP_ENV=development \
    NODE_ENV=development \
    HOST=0.0.0.0 \
    PORT=4000 \
    FRONTEND_URL=https://dev.meetifyy.app \
    BACKEND_URL=https://api-dev.meetifyy.app \
    EMAIL_DRIVER=resend \
    EMAIL_FROM=noreply@meetifyy.app \
    STORAGE_PROVIDER=r2 \
    R2_BUCKET_NAME=meetifyy-dev \
    REDIS_QUEUE_PREFIX="bull:development" \
  --secrets \
    database-url="YOUR_DEV_SUPABASE_DATABASE_URL" \
    direct-url="YOUR_DEV_SUPABASE_DIRECT_URL" \
    redis-url="YOUR_DEV_REDIS_URL" \
    supabase-url="YOUR_DEV_SUPABASE_URL" \
    supabase-anon-key="YOUR_DEV_SUPABASE_ANON_KEY" \
    supabase-service-role-key="YOUR_DEV_SUPABASE_SERVICE_ROLE_KEY" \
    supabase-jwt-secret="YOUR_DEV_SUPABASE_JWT_SECRET" \
    admin-jwt-access-secret="YOUR_DEV_ADMIN_JWT_ACCESS_SECRET" \
    admin-jwt-refresh-secret="YOUR_DEV_ADMIN_JWT_REFRESH_SECRET" \
    admin-jwt-pending-secret="YOUR_DEV_ADMIN_JWT_PENDING_SECRET" \
    resend-api-key="YOUR_DEV_RESEND_API_KEY" \
    r2-access-key-id="YOUR_DEV_R2_ACCESS_KEY_ID" \
    r2-secret-access-key="YOUR_DEV_R2_SECRET_ACCESS_KEY" \
    sentry-dsn="YOUR_SENTRY_DSN"
```

Then add the secret-backed env vars to the DEV Container App:

```bash
az containerapp update \
  --name meetifyy-api-dev \
  --resource-group meetifyy-dev-rg \
  --set-env-vars \
    "DATABASE_URL=secretref:database-url" \
    "DIRECT_URL=secretref:direct-url" \
    "REDIS_URL=secretref:redis-url" \
    "SUPABASE_URL=secretref:supabase-url" \
    "SUPABASE_ANON_KEY=secretref:supabase-anon-key" \
    "SUPABASE_SERVICE_ROLE_KEY=secretref:supabase-service-role-key" \
    "SUPABASE_JWT_SECRET=secretref:supabase-jwt-secret" \
    "ADMIN_JWT_ACCESS_SECRET=secretref:admin-jwt-access-secret" \
    "ADMIN_JWT_REFRESH_SECRET=secretref:admin-jwt-refresh-secret" \
    "ADMIN_JWT_PENDING_SECRET=secretref:admin-jwt-pending-secret" \
    "RESEND_API_KEY=secretref:resend-api-key" \
    "R2_ACCESS_KEY_ID=secretref:r2-access-key-id" \
    "R2_SECRET_ACCESS_KEY=secretref:r2-secret-access-key" \
    "SENTRY_DSN=secretref:sentry-dsn"
```

The production Container App uses the same structure — see §3.6 above — but
with `--resource-group meetifyy-prod-rg`, `--name meetifyy-api`, and PROD
credentials.

---

### 23.5 Critical environment variable differences

These variables **must differ** between DEV and PROD:

| Variable | DEV value | PROD value |
|----------|-----------|------------|
| `APP_ENV` | `development` | `production` |
| `NODE_ENV` | `development` | `production` |
| `FRONTEND_URL` | `https://dev.meetifyy.app` | `https://meetifyy.app` |
| `BACKEND_URL` | `https://api-dev.meetifyy.app` | `https://api.meetifyy.app` |
| `DATABASE_URL` | DEV Supabase pooled URL | PROD Supabase pooled URL |
| `DIRECT_URL` | DEV Supabase direct URL | PROD Supabase direct URL |
| `REDIS_URL` | DEV Redis URL | PROD Redis URL |
| `REDIS_QUEUE_PREFIX` | `bull:development` | `bull:production` (default) |
| `R2_BUCKET_NAME` | `meetifyy-dev` | `meetifyy-prod` |
| `SUPABASE_URL` | DEV Supabase project URL | PROD Supabase project URL |
| `SUPABASE_ANON_KEY` | DEV anon key | PROD anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | DEV service role key | PROD service role key |
| `COOKIE_DOMAIN` | `.dev.meetifyy.app` or unset | `.meetifyy.app` |

> [!IMPORTANT]
> `REDIS_QUEUE_PREFIX` is the firewall between DEV and PROD Redis queues.
> If both environments share the same Redis instance, the prefix prevents a
> DEV worker from consuming a PROD job or vice versa. The backend sets it to
> `bull:development` in development and `bull:production` in production by
> default (via `APP_ENV`). You only need to set it explicitly if overriding.

---

### 23.6 Prisma Migration Workflow

#### What the commands do

| Command | When to use | What it does |
|---------|------------|--------------|
| `npx prisma migrate dev --name <name>` | Local / DEV only | Creates a migration file + applies it |
| `npx prisma migrate deploy` | Production deployment | Applies committed migration files only |
| `npx prisma migrate status` | Anytime | Shows which migrations are applied |
| `npx prisma generate` | After schema change | Re-generates the TypeScript client |
| `npx prisma db push` | **NEVER in production** | Bypasses migration history — banned |
| `npx prisma migrate reset` | **NEVER in production** | Wipes the database — banned |

#### Step-by-step: adding a new field to the database

This example adds a `bio` field to the `User` model.

**Step 1 — Modify schema.prisma locally**
```prisma
model User {
  id   String @id @default(uuid())
  name String
  bio  String?   // ← new optional field
}
```

**Step 2 — Create a migration against the DEV database**
```bash
cd backend

# DATABASE_URL must point to YOUR DEV database (set in .env.local)
npx prisma migrate dev --name add_user_bio
```

Prisma will:
1. Detect the schema change
2. Generate `prisma/migrations/20260827XXXXXX_add_user_bio/migration.sql`
3. Apply it to the DEV database
4. Regenerate the Prisma client

**Step 3 — Verify the migration**
```bash
npx prisma migrate status
# Should show: All migrations applied
```

**Step 4 — Test the application**
```bash
npm run start:dev
# Test your new feature against the DEV database
```

**Step 5 — Commit both files**
```bash
git add prisma/schema.prisma
git add prisma/migrations/20260827XXXXXX_add_user_bio/
git commit -m "feat: add user bio field"
git push origin development
```

**Step 6 — Development deployment**

`deploy-dev.yml` triggers automatically. It runs:
```
prisma migrate deploy   ← applies the committed migration to DEV Supabase
node dist/main          ← starts the updated API
```

**Step 7 — Test in the development environment**

Verify the feature works at `https://api-dev.meetifyy.app`.

**Step 8 — Promote to production**

Open a Pull Request: `development` → `main`. CI runs. After review and merge:

`deploy-prod.yml` triggers automatically. It runs:
```
prisma migrate deploy   ← applies the SAME committed migration to PROD Supabase
node dist/main          ← starts the updated API in production
```

The migration file is identical — the same SQL that was tested in DEV is what
applies to PROD. No migration is generated during production deployment.

---

### 23.7 Safe migration patterns

> [!WARNING]
> Some schema changes are **destructive or breaking** if deployed naively.
> Prisma's `migrate deploy` will apply whatever SQL is in the migration file —
> it is your responsibility to write safe migrations.

#### Adding a nullable column — Safe

```sql
ALTER TABLE "User" ADD COLUMN "bio" TEXT;
```
This is always safe — existing rows get `NULL`, running code is unaffected.

#### Adding a NOT NULL column without a default — Dangerous

```sql
ALTER TABLE "User" ADD COLUMN "score" INTEGER NOT NULL;
-- ^^^ This will FAIL if the table has existing rows.
```

Safe multi-step approach:
1. **Migration 1**: Add as nullable → deploy
2. **Migration 2** (later): Backfill `NULL` values → deploy
3. **Migration 3** (later): Add `NOT NULL` constraint → deploy

#### Dropping a column — Dangerous

Never drop a column while the current production code still reads it.

Safe multi-step approach:
1. Remove all reads of the column from application code → deploy
2. After the old code is no longer running: drop the column → deploy

#### Renaming a column — Dangerous

Prisma treats a rename as drop + add, breaking running code.

Safe approach:
1. Add the new column name → deploy
2. Backfill data from old column → deploy
3. Remove reads of old column → deploy
4. Drop old column → deploy

#### Checking for dangerous migrations before merging

```bash
# Check what SQL a migration will run
cat prisma/migrations/LATEST_MIGRATION/migration.sql

# Verify no DROP TABLE, DROP COLUMN, or ALTER COLUMN NOT NULL on existing data
grep -E "DROP|NOT NULL|RENAME" prisma/migrations/LATEST_MIGRATION/migration.sql
```

---

### 23.8 Rollback: Application vs Database

> [!IMPORTANT]
> Rolling back the application image does **not** roll back database migrations.
> A database migration, once applied, persists until a new migration reverses it.

#### Application rollback (fast — seconds)

```bash
# List recent PROD images
az acr repository show-tags \
  --name meetifyycr \
  --repository meetifyy-api \
  --orderby time_desc \
  --output table | grep prod-

# Roll back to a previous image
az containerapp update \
  --name meetifyy-api \
  --resource-group meetifyy-prod-rg \
  --image meetifyycr.azurecr.io/meetifyy-api:prod-PREVIOUS_SHA
```

This restores the old application code in seconds. If the old code is
compatible with the current database schema (backward-compatible migrations),
this is sufficient.

#### Database rollback (complex — requires a new migration)

If a migration introduced a breaking change:

1. **Write a reversal migration** that undoes the schema change:
   ```bash
   npx prisma migrate dev --name revert_problematic_change
   ```

2. **Commit and push** to `development`, verify, then promote to `main`.

3. The production deployment will apply the reversal migration.

**There is no `prisma migrate rollback` command.** Prisma's philosophy is
forward-fix: write a new migration that corrects the problem rather than
rolling back.

#### Production backup before risky migrations

Before any migration that drops data or alters constraints:

```bash
# In Supabase dashboard → Database → Backups
# Enable point-in-time recovery or take a manual backup

# Or use pg_dump via the DIRECT_URL
pg_dump "YOUR_DIRECT_URL" > backup_$(date +%Y%m%d_%H%M%S).sql
```

---

### 23.9 Docker image tagging strategy

| Tag | Meaning | Lifetime |
|-----|---------|---------|
| `dev-<sha>` | DEV build at that commit | Keep for 30 days |
| `dev-latest` | Latest DEV build | Mutable — overwritten each push |
| `prod-<sha>` | PROD build at that commit | Keep indefinitely for rollback |
| `prod-latest` | Latest PROD build | Mutable — overwritten each merge |

The `prod-<sha>` tags are your production rollback targets. Never delete them
manually. Use the ACR purge policy to clean up `dev-*` tags automatically:

```bash
# Auto-purge DEV images older than 30 days
az acr task create \
  --registry meetifyycr \
  --name purge-dev-images \
  --cmd "acr purge --filter 'meetifyy-api:dev-.*' --ago 30d --untagged" \
  --schedule "0 2 * * *" \
  --context /dev/null
```

---

### 23.10 OIDC service principals — DEV and PROD

Each environment gets its own service principal so a compromised DEV credential
cannot access PROD resources.

```bash
# DEV service principal (scoped to meetifyy-dev-rg only)
az ad sp create-for-rbac \
  --name meetifyy-github-actions-dev \
  --role Contributor \
  --scopes /subscriptions/YOUR_SUBSCRIPTION_ID/resourceGroups/meetifyy-dev-rg

# Note the appId → AZURE_CLIENT_ID_DEV

# DEV federated credentials.
# The `environment:` subject is the one deploy-dev.yml actually presents;
# the branch subject is kept only as a fallback. Registering just the branch
# form is what caused five consecutive DEV deploy failures.
az ad app federated-credential create \
  --id YOUR_DEV_APP_ID \
  --parameters '{
    "name": "meetifyy-dev-environment",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:YOUR_ORG/meetifyy:environment:development",
    "audiences": ["api://AzureADTokenExchange"]
  }'

az ad app federated-credential create \
  --id YOUR_DEV_APP_ID \
  --parameters '{
    "name": "meetifyy-dev-branch",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:YOUR_ORG/meetifyy:ref:refs/heads/development",
    "audiences": ["api://AzureADTokenExchange"]
  }'

# ─────────────────────────────────────────────────────────────────────────────

# PROD service principal (scoped to meetifyy-prod-rg only)
az ad sp create-for-rbac \
  --name meetifyy-github-actions-prod \
  --role Contributor \
  --scopes /subscriptions/YOUR_SUBSCRIPTION_ID/resourceGroups/meetifyy-prod-rg

# Note the appId → AZURE_CLIENT_ID_PROD

# PROD federated credentials (environment subject first — see the DEV note)
az ad app federated-credential create \
  --id YOUR_PROD_APP_ID \
  --parameters '{
    "name": "meetifyy-prod-environment",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:YOUR_ORG/meetifyy:environment:production",
    "audiences": ["api://AzureADTokenExchange"]
  }'

az ad app federated-credential create \
  --id YOUR_PROD_APP_ID \
  --parameters '{
    "name": "meetifyy-prod-branch",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:YOUR_ORG/meetifyy:ref:refs/heads/main",
    "audiences": ["api://AzureADTokenExchange"]
  }'

# Grant AcrPush to both service principals
ACR_ID=$(az acr show --name meetifyycr --query id --output tsv)

az role assignment create \
  --assignee YOUR_DEV_APP_ID --role AcrPush --scope "$ACR_ID"

az role assignment create \
  --assignee YOUR_PROD_APP_ID --role AcrPush --scope "$ACR_ID"
```

The DEV service principal has **Contributor** rights on `meetifyy-dev-rg` only.
It cannot create, modify, or delete anything in `meetifyy-prod-rg`.
The PROD service principal is the mirror image.

---

### 23.11 Complete dev → prod checklist

Use this checklist before every production deployment:

```
Schema changes
[ ] Schema change made in schema.prisma
[ ] `prisma migrate dev --name <name>` run against DEV database
[ ] Migration file committed to Git alongside schema.prisma
[ ] Migration applied successfully in DEV environment
[ ] Application tested in DEV with new schema
[ ] No destructive SQL in migration.sql (or safe multi-step plan in place)

Code changes
[ ] Feature tested in DEV
[ ] Unit/integration tests pass
[ ] CI passes on development branch

Pull Request
[ ] PR opened: development → main
[ ] CI passes on the PR
[ ] At least 1 reviewer approved
[ ] No merge conflicts

Production deployment (automated by deploy-prod.yml)
[ ] GitHub Actions: prisma migrate deploy → PROD Supabase ✓
[ ] GitHub Actions: new image deployed to meetifyy-api ✓
[ ] Health check: GET /health returns 200 ✓

Post-deploy verification
[ ] REST API responding
[ ] Socket.IO connections working
[ ] BullMQ processing jobs (check Resend for email delivery)
[ ] Sentry shows no new errors
[ ] Logs look clean
```

