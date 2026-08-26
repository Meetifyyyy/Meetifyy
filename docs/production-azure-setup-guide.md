# Meetifyy Production Infrastructure Setup Guide (For Agent / Developer)

> **Purpose**: This document contains the exact, step-by-step procedure for an AI agent or engineer to provision, configure, and connect the **Production** environment for Meetifyy on Microsoft Azure, Supabase, Cloudflare, Resend, and GitHub Actions.

---

## 1. Overview & Architecture

Meetifyy follows a strict two-environment model with complete database and secret isolation:

```
                    GitHub Repository
                            │
            ┌───────────────┴───────────────┐
            │                               │
     development branch                 main branch
            │                               │
            ▼                               ▼
        Azure DEV                       Azure PROD
     (meetifyy-dev-rg)              (meetifyy-prod-rg)
            │                               │
     meetifyy-api-dev                   meetifyy-api
     (Container App)                 (Container App)
            │                               │
     Supabase DEV                    Supabase PROD
     PostgreSQL                      PostgreSQL
            │                               │
     DEV Redis, R2, Resend           PROD Redis, R2, Resend
```

### Safety Principles:
1. **Never use development credentials in production.**
2. **Never store the production database URL in GitHub repository secrets** (it is stored strictly inside the Azure Container App secret store).
3. **Never run `prisma db push` or `prisma migrate dev` on production** (production deployments automatically run `prisma migrate deploy`).
4. **Day-to-day development code and local `.env` remain connected to DEV.**

---

## 2. Production Prerequisites Checklist

Before running the production setup, gather the following production accounts and credentials:

| Service | Setting / Value Needed | Notes |
|---------|------------------------|-------|
| **Azure** | Production Subscription ID & Tenant ID | Can be in the same Azure tenant or separate |
| **Supabase** | `meetifyy-prod` Project URL, Anon Key, Service Role Key, JWT Secret | Separate Supabase project |
| **Supabase DB** | `DATABASE_URL` (Port 6543, Transaction Pooler) | For runtime backend |
| **Supabase DB** | `DIRECT_URL` (Port 5432, Direct Session Mode) | For Prisma migrations |
| **Redis** | Production `REDIS_URL` | e.g. Upstash or Redis Cloud |
| **Cloudflare R2** | Bucket: `meetifyy-prod`, Access Key, Secret Key, Account ID | Separate production bucket |
| **Resend** | Production `RESEND_API_KEY`, Verified domain: `meetifyy.app` | Production transactional email |
| **Sentry** | Production `SENTRY_DSN` | Dedicated Sentry prod project |
| **Domain** | `api.meetifyy.app` | Added as CNAME in Cloudflare |

---

## 3. Automated Production Provisioning Script (`setup-azure-prod.sh`)

A dedicated companion script `setup-azure-prod.sh` is provided in the repository root.

### Running the Setup:

```bash
# 1. Login to Azure with the production account:
az login

# 2. Run the production setup script:
./setup-azure-prod.sh
```

---

## 4. Manual Step-by-Step CLI Walkthrough (If executing commands directly)

### Step 4.1: Azure Resource Creation

```bash
# Set your production subscription
az account set --subscription "<PROD_SUBSCRIPTION_ID>"

# Create production resource group
az group create --name meetifyy-prod-rg --location centralindia

# Create production Log Analytics workspace
az monitor log-analytics workspace create \
  --resource-group meetifyy-prod-rg \
  --workspace-name meetifyy-prod-logs \
  --location centralindia

WORKSPACE_ID=$(az monitor log-analytics workspace show \
  --resource-group meetifyy-prod-rg \
  --workspace-name meetifyy-prod-logs \
  --query customerId --output tsv)

WORKSPACE_KEY=$(az monitor log-analytics workspace get-shared-keys \
  --resource-group meetifyy-prod-rg \
  --workspace-name meetifyy-prod-logs \
  --query primarySharedKey --output tsv)

# Create production Container Apps Environment
az containerapp env create \
  --name meetifyy-prod-env \
  --resource-group meetifyy-prod-rg \
  --location centralindia \
  --logs-workspace-id "$WORKSPACE_ID" \
  --logs-workspace-key "$WORKSPACE_KEY"
```

---

### Step 4.2: Provision `meetifyy-api` (Production Container App)

```bash
az containerapp create \
  --name meetifyy-api \
  --resource-group meetifyy-prod-rg \
  --environment meetifyy-prod-env \
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
    FRONTEND_URL="https://meetifyy.app" \
    BACKEND_URL="https://api.meetifyy.app" \
    ADMIN_URL="https://admin.meetifyy.app" \
    CORS_ORIGINS="https://meetifyy.app,https://www.meetifyy.app" \
    CORS_ORIGIN_PATTERNS="https://*.meetifyy.app" \
    COOKIE_DOMAIN=".meetifyy.app" \
    COOKIE_SECURE="true" \
    COOKIE_SAME_SITE="strict" \
    EMAIL_DRIVER=resend \
    EMAIL_FROM="noreply@meetifyy.app" \
    STORAGE_PROVIDER=r2 \
    R2_BUCKET_NAME="meetifyy-prod" \
    REDIS_QUEUE_PREFIX="bull:production" \
    SENTRY_TRACES_SAMPLE_RATE="0.1" \
    SENTRY_PROFILES_SAMPLE_RATE="0.05" \
  --secrets \
    "database-url=<PROD_SUPABASE_DATABASE_URL>" \
    "direct-url=<PROD_SUPABASE_DIRECT_URL>" \
    "redis-url=<PROD_REDIS_URL>" \
    "supabase-url=<PROD_SUPABASE_URL>" \
    "supabase-anon-key=<PROD_SUPABASE_ANON_KEY>" \
    "supabase-service-role-key=<PROD_SUPABASE_SERVICE_ROLE_KEY>" \
    "admin-jwt-access-secret=<PROD_ADMIN_JWT_ACCESS_SECRET>" \
    "admin-jwt-refresh-secret=<PROD_ADMIN_JWT_REFRESH_SECRET>" \
    "admin-jwt-pending-secret=<PROD_ADMIN_JWT_PENDING_SECRET>" \
    "resend-api-key=<PROD_RESEND_API_KEY>" \
    "r2-access-key-id=<PROD_R2_ACCESS_KEY_ID>" \
    "r2-secret-access-key=<PROD_R2_SECRET_ACCESS_KEY>" \
    "sentry-dsn=<PROD_SENTRY_DSN>"

# Wire secret references into environment variables:
az containerapp update \
  --name meetifyy-api \
  --resource-group meetifyy-prod-rg \
  --set-env-vars \
    "DATABASE_URL=secretref:database-url" \
    "DIRECT_URL=secretref:direct-url" \
    "REDIS_URL=secretref:redis-url" \
    "SUPABASE_URL=secretref:supabase-url" \
    "SUPABASE_ANON_KEY=secretref:supabase-anon-key" \
    "SUPABASE_SERVICE_ROLE_KEY=secretref:supabase-service-role-key" \
    "ADMIN_JWT_ACCESS_SECRET=secretref:admin-jwt-access-secret" \
    "ADMIN_JWT_REFRESH_SECRET=secretref:admin-jwt-refresh-secret" \
    "ADMIN_JWT_PENDING_SECRET=secretref:admin-jwt-pending-secret" \
    "RESEND_API_KEY=secretref:resend-api-key" \
    "R2_ACCESS_KEY_ID=secretref:r2-access-key-id" \
    "R2_SECRET_ACCESS_KEY=secretref:r2-secret-access-key" \
    "SENTRY_DSN=secretref:sentry-dsn"
```

---

### Step 4.3: Service Principal & GitHub OIDC Federation (Production)

```bash
# Create service principal scoped to production resource group
SP_JSON=$(az ad sp create-for-rbac \
  --name "meetifyy-github-actions-prod" \
  --role Contributor \
  --scopes "/subscriptions/<PROD_SUBSCRIPTION_ID>/resourceGroups/meetifyy-prod-rg" \
  --output json)

PROD_CLIENT_ID=$(echo "$SP_JSON" | grep -o '"appId": "[^"]*' | cut -d'"' -f4)

# Create federated credential bound exclusively to the 'main' branch
az ad app federated-credential create \
  --id "$PROD_CLIENT_ID" \
  --parameters "{
    \"name\": \"meetifyy-prod-branch\",
    \"issuer\": \"https://token.actions.githubusercontent.com\",
    \"subject\": \"repo:Meetifyyyy/Meetifyy:ref:refs/heads/main\",
    \"audiences\": [\"api://AzureADTokenExchange\"]
  }"

# Grant push rights to ACR
ACR_ID=$(az acr show --name meetifyycr --resource-group meetifyy-dev-rg --query id --output tsv)
az role assignment create --assignee "$PROD_CLIENT_ID" --role AcrPush --scope "$ACR_ID"
```

---

## 5. Configuring GitHub Environment Secrets

1. Go to: **[GitHub Repository → Settings → Environments](https://github.com/Meetifyyyy/Meetifyy/settings/environments)**
2. Click **New environment** → Name it **`production`**.
3. *(Recommended)*: Under **Deployment branches**, restrict to `main` only. Enable **Required reviewers**.
4. Add the following **Environment Secrets**:

| Secret Name | Value |
|-------------|-------|
| `AZURE_CLIENT_ID_PROD` | `$PROD_CLIENT_ID` (from step 4.3) |
| `AZURE_TENANT_ID` | Production Azure Tenant ID |
| `AZURE_SUBSCRIPTION_ID` | Production Azure Subscription ID |
| `ACR_LOGIN_SERVER` | `meetifyycr.azurecr.io` |
| `AZURE_RESOURCE_GROUP_PROD` | `meetifyy-prod-rg` |
| `AZURE_CONTAINERAPP_PROD` | `meetifyy-api` |

---

## 6. Cloudflare DNS & Custom Domain

1. In Azure Portal, copy the FQDN of `meetifyy-api` (e.g. `meetifyy-api.xyz.centralindia.azurecontainerapps.io`).
2. Go to **Cloudflare** → `meetifyy.app` → **DNS Records** → **Add Record**:
   * **Type**: `CNAME`
   * **Name**: `api`
   * **Target**: `meetifyy-api.xyz.centralindia.azurecontainerapps.io`
   * **Proxy Status**: **Proxied (Orange Cloud ☁️)**
3. In Azure Portal under `meetifyy-api` → **Custom domains**, bind `api.meetifyy.app` with managed certificate.

---

## 7. How Production Runs Day-to-Day

Once the one-time production setup above is finished:

1. Developers code and test on the `development` branch.
2. When ready for production, open a Pull Request: `development` → `main`.
3. Merge the Pull Request into `main`.
4. **GitHub Actions (`deploy-prod.yml`) automatically:**
   * Builds the immutable Docker image `meetifyy-api:prod-<sha>`.
   * Runs `npx prisma migrate deploy` on the **Production Supabase database**.
   * Deploys the image to `meetifyy-api` on Azure PROD.
   * Performs automated health check on `https://api.meetifyy.app/health`.

---

## 8. Rollback Procedure

If a production release ever needs to be rolled back:

```bash
# 1. List available production image tags
az acr repository show-tags --name meetifyycr --repository meetifyy-api --output table | grep prod-

# 2. Update Container App to previous good tag
az containerapp update \
  --name meetifyy-api \
  --resource-group meetifyy-prod-rg \
  --image meetifyycr.azurecr.io/meetifyy-api:prod-<PREVIOUS_SHA>
```

