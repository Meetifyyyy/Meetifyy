#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# Meetifyy — Automated Azure PROD Provisioning Script
# ─────────────────────────────────────────────────────────────────────────────

LOCATION="uaenorth"
RESOURCE_GROUP="meetifyy-prod-rg"
ACR_NAME="meetifyycr"
LOGS_WORKSPACE="meetifyy-prod-logs"
ENV_NAME="meetifyy-prod-env"
APP_NAME="meetifyy-api"

echo "==> Meetifyy Production Provisioning"
echo "Make sure you have your Production Supabase, Redis, R2, and Resend credentials ready."
echo ""

read -rp "Enter Production Azure Subscription ID: " SUBSCRIPTION_ID
read -rp "Enter Production Azure Tenant ID: " TENANT_ID
read -rp "Enter Production Supabase DATABASE_URL (Transaction pooler, port 6543): " DATABASE_URL
read -rp "Enter Production Supabase DIRECT_URL (Direct connection, port 5432): " DIRECT_URL
read -rp "Enter Production Supabase URL (https://<ref>.supabase.co): " SUPABASE_URL
read -rp "Enter Production Supabase Anon Key: " SUPABASE_ANON_KEY
read -rp "Enter Production Supabase Service Role Key: " SUPABASE_SERVICE_ROLE_KEY
read -rp "Enter Production Redis URL (rediss://...): " REDIS_URL
read -rp "Enter Production Resend API Key: " RESEND_API_KEY
read -rp "Enter Production R2 Access Key ID: " R2_ACCESS_KEY_ID
read -rp "Enter Production R2 Secret Access Key: " R2_SECRET_ACCESS_KEY
read -rp "Enter Production R2 Account ID: " R2_ACCOUNT_ID
read -rp "Enter Production Sentry DSN (optional, press Enter to skip): " SENTRY_DSN

# Generate secure random admin JWT secrets for production:
ADMIN_JWT_ACCESS_SECRET=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
ADMIN_JWT_REFRESH_SECRET=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
ADMIN_JWT_PENDING_SECRET=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")

echo ""
echo "==> 1. Setting Azure Subscription..."
az account set --subscription "$SUBSCRIPTION_ID"

echo "==> 2. Creating PROD Resource Group ($RESOURCE_GROUP)..."
if ! az group show --name "$RESOURCE_GROUP" >/dev/null 2>&1; then
  az group create --name "$RESOURCE_GROUP" --location "$LOCATION"
fi

echo "==> 3. Creating Log Analytics Workspace ($LOGS_WORKSPACE in $LOCATION)..."
if ! az monitor log-analytics workspace show --resource-group "$RESOURCE_GROUP" --workspace-name "$LOGS_WORKSPACE" >/dev/null 2>&1; then
  az monitor log-analytics workspace create \
    --resource-group "$RESOURCE_GROUP" \
    --workspace-name "$LOGS_WORKSPACE" \
    --location "$LOCATION"
fi

WORKSPACE_ID=$(az monitor log-analytics workspace show \
  --resource-group "$RESOURCE_GROUP" \
  --workspace-name "$LOGS_WORKSPACE" \
  --query customerId --output tsv)

WORKSPACE_KEY=$(az monitor log-analytics workspace get-shared-keys \
  --resource-group "$RESOURCE_GROUP" \
  --workspace-name "$LOGS_WORKSPACE" \
  --query primarySharedKey --output tsv)

echo "==> 4. Creating Container Apps Environment ($ENV_NAME in $LOCATION)..."
if ! az containerapp env show --name "$ENV_NAME" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1; then
  az containerapp env create \
    --name "$ENV_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --location "$LOCATION" \
    --logs-workspace-id "$WORKSPACE_ID" \
    --logs-workspace-key "$WORKSPACE_KEY"
fi

if [ -z "${REDIS_URL:-}" ]; then
  echo "==> 4b. Provisioning Dedicated Production Redis Container (meetifyy-redis-prod)..."
  az containerapp create \
    --name meetifyy-redis-prod \
    --resource-group "$RESOURCE_GROUP" \
    --environment "$ENV_NAME" \
    --image redis:7-alpine \
    --target-port 6379 \
    --ingress internal \
    --transport tcp \
    --min-replicas 1 \
    --max-replicas 1 \
    --cpu 0.25 \
    --memory 0.5Gi 2>/dev/null || true
  REDIS_URL="redis://meetifyy-redis-prod:6379"
fi

# R2_VERIFICATION_BUCKET_NAME is the private bucket for account-verification
# documents (selfie + college ID). It is passed through from the environment and
# defaults to empty on purpose: unset falls back to R2_BUCKET_NAME, which is the
# existing behaviour, whereas naming a bucket that does not exist yet would break
# verification uploads on the next deploy. Export it once the bucket is created,
# and make sure that bucket has NO public access - no r2.dev URL, no custom domain.
echo "==> 5. Creating Production Container App ($APP_NAME)..."
az containerapp create \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --environment "$ENV_NAME" \
  --image mcr.microsoft.com/azuredocs/containerapps-helloworld:latest \
  --target-port 4000 \
  --ingress external \
  --transport http \
  --min-replicas 1 \
  --max-replicas 1 \
  --cpu 0.5 \
  --memory 1Gi \
  --registry-server "${ACR_NAME}.azurecr.io" \
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
    R2_ACCOUNT_ID="$R2_ACCOUNT_ID" \
    R2_BUCKET_NAME="meetifyy-prod" \
    R2_VERIFICATION_BUCKET_NAME="${R2_VERIFICATION_BUCKET_NAME:-}" \
    REDIS_QUEUE_PREFIX="bull:production" \
    SENTRY_TRACES_SAMPLE_RATE="0.1" \
    SENTRY_PROFILES_SAMPLE_RATE="0.05" \
  --secrets \
    "database-url=${DATABASE_URL}" \
    "direct-url=${DIRECT_URL}" \
    "redis-url=${REDIS_URL}" \
    "supabase-url=${SUPABASE_URL}" \
    "supabase-anon-key=${SUPABASE_ANON_KEY}" \
    "supabase-service-role-key=${SUPABASE_SERVICE_ROLE_KEY}" \
    "admin-jwt-access-secret=${ADMIN_JWT_ACCESS_SECRET}" \
    "admin-jwt-refresh-secret=${ADMIN_JWT_REFRESH_SECRET}" \
    "admin-jwt-pending-secret=${ADMIN_JWT_PENDING_SECRET}" \
    "resend-api-key=${RESEND_API_KEY}" \
    "r2-access-key-id=${R2_ACCESS_KEY_ID}" \
    "r2-secret-access-key=${R2_SECRET_ACCESS_KEY}" \
    "sentry-dsn=${SENTRY_DSN:-placeholder}"

echo "==> 6. Wiring secret references to container environment variables..."
az containerapp update \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
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

echo "==> 7. Creating GitHub Actions Service Principal for Production..."
SP_JSON=$(az ad sp create-for-rbac \
  --name "meetifyy-github-actions-prod" \
  --role Contributor \
  --scopes "/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP}" \
  --output json)

PROD_CLIENT_ID=$(echo "$SP_JSON" | grep -o '"appId": "[^"]*' | cut -d'"' -f4)

# See the note in setup-azure-dev.sh: deploy-prod.yml declares
# `environment: production`, so GitHub presents `environment:production`
# rather than `ref:refs/heads/main`. Both subjects are registered.
echo "==> 8. Configuring Federated Credentials for GitHub Actions (environment + branch)..."
az ad app federated-credential create \
  --id "$PROD_CLIENT_ID" \
  --parameters "{
    \"name\": \"meetifyy-prod-environment\",
    \"issuer\": \"https://token.actions.githubusercontent.com\",
    \"subject\": \"repo:Meetifyyyy/Meetifyy:environment:production\",
    \"audiences\": [\"api://AzureADTokenExchange\"]
  }" || true

# Kept so the workflow still authenticates if `environment:` is ever dropped.
az ad app federated-credential create \
  --id "$PROD_CLIENT_ID" \
  --parameters "{
    \"name\": \"meetifyy-prod-branch\",
    \"issuer\": \"https://token.actions.githubusercontent.com\",
    \"subject\": \"repo:Meetifyyyy/Meetifyy:ref:refs/heads/main\",
    \"audiences\": [\"api://AzureADTokenExchange\"]
  }" || true

ACR_ID=$(az acr show --name "$ACR_NAME" --query id --output tsv 2>/dev/null || true)
if [ -n "$ACR_ID" ]; then
  az role assignment create --assignee "$PROD_CLIENT_ID" --role AcrPush --scope "$ACR_ID" || true
fi

echo "─────────────────────────────────────────────────────────────────────────────"
echo "✅ Azure PROD Provisioning Complete!"
echo "─────────────────────────────────────────────────────────────────────────────"
echo "Now add these 6 secrets to GitHub (Settings -> Environments -> production):"
echo "  AZURE_CLIENT_ID_PROD      = $PROD_CLIENT_ID"
echo "  AZURE_TENANT_ID           = $TENANT_ID"
echo "  AZURE_SUBSCRIPTION_ID     = $SUBSCRIPTION_ID"
echo "  ACR_LOGIN_SERVER          = ${ACR_NAME}.azurecr.io"
echo "  AZURE_RESOURCE_GROUP_PROD = $RESOURCE_GROUP"
echo "  AZURE_CONTAINERAPP_PROD   = $APP_NAME"
echo "─────────────────────────────────────────────────────────────────────────────"
