#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# Meetifyy — Automated Azure DEV Provisioning Script
# ─────────────────────────────────────────────────────────────────────────────

SUBSCRIPTION_ID="4f4979b4-2a88-469a-9347-e53f4ae83005"
TENANT_ID="7339fc19-f2ee-4b86-adc9-ecd6d13b1a4d"
# Using uaenorth (allowed by your subscription policy, ~25-30ms from India, full student capacity)
APP_LOCATION="uaenorth"
RESOURCE_GROUP="meetifyy-dev-rg"
ACR_NAME="meetifyycr"
LOGS_WORKSPACE="meetifyy-dev-logs"
ENV_NAME="meetifyy-dev-env"
APP_NAME="meetifyy-api-dev"

echo "==> 1. Setting Azure Subscription..."
az account set --subscription "$SUBSCRIPTION_ID"

echo "==> 2. Verifying Resource Group ($RESOURCE_GROUP)..."
if ! az group show --name "$RESOURCE_GROUP" >/dev/null 2>&1; then
  az group create --name "$RESOURCE_GROUP" --location "$APP_LOCATION"
fi

echo "==> 3. Creating/Checking Container Registry ($ACR_NAME)..."
if ! az acr show --name "$ACR_NAME" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1; then
  az acr create \
    --resource-group "$RESOURCE_GROUP" \
    --name "$ACR_NAME" \
    --sku Basic \
    --admin-enabled true \
    --location "$APP_LOCATION" || true
fi

echo "==> 4. Creating Log Analytics Workspace ($LOGS_WORKSPACE in $APP_LOCATION)..."
if ! az monitor log-analytics workspace show --resource-group "$RESOURCE_GROUP" --workspace-name "$LOGS_WORKSPACE" >/dev/null 2>&1; then
  az monitor log-analytics workspace create \
    --resource-group "$RESOURCE_GROUP" \
    --workspace-name "$LOGS_WORKSPACE" \
    --location "$APP_LOCATION"
fi

WORKSPACE_ID=$(az monitor log-analytics workspace show \
  --resource-group "$RESOURCE_GROUP" \
  --workspace-name "$LOGS_WORKSPACE" \
  --query customerId --output tsv)

WORKSPACE_KEY=$(az monitor log-analytics workspace get-shared-keys \
  --resource-group "$RESOURCE_GROUP" \
  --workspace-name "$LOGS_WORKSPACE" \
  --query primarySharedKey --output tsv)

echo "==> 5. Creating Container Apps Environment ($ENV_NAME in $APP_LOCATION)..."
if ! az containerapp env show --name "$ENV_NAME" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1; then
  az containerapp env create \
    --name "$ENV_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --location "$APP_LOCATION" \
    --logs-workspace-id "$WORKSPACE_ID" \
    --logs-workspace-key "$WORKSPACE_KEY"
fi

# Load local backend .env values
ENV_FILE="backend/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "Error: backend/.env not found!"
  exit 1
fi

get_env() {
  grep "^$1=" "$ENV_FILE" | cut -d '=' -f2- | tr -d '\r' | tr -d '"' | tr -d "'"
}

DATABASE_URL=$(get_env DATABASE_URL)
DIRECT_URL=$(get_env DIRECT_URL)
REDIS_URL=$(get_env REDIS_URL)
SUPABASE_URL=$(get_env SUPABASE_URL)
SUPABASE_ANON_KEY=$(get_env SUPABASE_ANON_KEY)
SUPABASE_SERVICE_ROLE_KEY=$(get_env SUPABASE_SERVICE_ROLE_KEY)
ADMIN_JWT_ACCESS_SECRET=$(get_env ADMIN_JWT_ACCESS_SECRET)
ADMIN_JWT_REFRESH_SECRET=$(get_env ADMIN_JWT_REFRESH_SECRET)
ADMIN_JWT_PENDING_SECRET=$(get_env ADMIN_JWT_PENDING_SECRET)
RESEND_API_KEY=$(get_env RESEND_API_KEY)
R2_ACCESS_KEY_ID=$(get_env R2_ACCESS_KEY_ID)
R2_SECRET_ACCESS_KEY=$(get_env R2_SECRET_ACCESS_KEY)
R2_ACCOUNT_ID=$(get_env R2_ACCOUNT_ID)
R2_BUCKET_NAME=$(get_env R2_BUCKET_NAME)
R2_PUBLIC_URL=$(get_env R2_PUBLIC_URL)
SENTRY_DSN=$(get_env SENTRY_DSN)

echo "==> 6. Creating Initial DEV Container App ($APP_NAME)..."
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
    APP_ENV=development \
    NODE_ENV=development \
    HOST=0.0.0.0 \
    PORT=4000 \
    APP_NAME=Meetifyy \
    FRONTEND_URL="https://dev.meetifyy.app" \
    BACKEND_URL="https://dev-api.meetifyy.app" \
    CORS_ORIGINS="https://dev.meetifyy.app,https://meetifyy.app" \
    CORS_ORIGIN_PATTERNS="https://*.meetifyy.app" \
    EMAIL_DRIVER=resend \
    EMAIL_FROM="noreply@meetifyy.app" \
    STORAGE_PROVIDER=r2 \
    R2_ACCOUNT_ID="$R2_ACCOUNT_ID" \
    R2_BUCKET_NAME="$R2_BUCKET_NAME" \
    R2_PUBLIC_URL="$R2_PUBLIC_URL" \
    REDIS_QUEUE_PREFIX="bull:development" \
    SENTRY_TRACES_SAMPLE_RATE="0.2" \
    SENTRY_PROFILES_SAMPLE_RATE="0.1" \
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
    "sentry-dsn=${SENTRY_DSN}"

echo "==> 7. Wiring secret references to container environment variables..."
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

echo "==> 8. Creating GitHub Actions Service Principal & OIDC..."
SP_JSON=$(az ad sp create-for-rbac \
  --name "meetifyy-github-actions-dev" \
  --role Contributor \
  --scopes "/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP}" \
  --output json)

CLIENT_ID=$(echo "$SP_JSON" | grep -o '"appId": "[^"]*' | cut -d'"' -f4)

echo "==> 9. Configuring Federated Credential for GitHub Actions (development branch)..."
az ad app federated-credential create \
  --id "$CLIENT_ID" \
  --parameters "{
    \"name\": \"meetifyy-dev-branch\",
    \"issuer\": \"https://token.actions.githubusercontent.com\",
    \"subject\": \"repo:Meetifyyyy/Meetifyy:ref:refs/heads/development\",
    \"audiences\": [\"api://AzureADTokenExchange\"]
  }" || true

ACR_ID=$(az acr show --name "$ACR_NAME" --resource-group "$RESOURCE_GROUP" --query id --output tsv)
az role assignment create --assignee "$CLIENT_ID" --role AcrPush --scope "$ACR_ID" || true

echo "─────────────────────────────────────────────────────────────────────────────"
echo "✅ Azure DEV Provisioning Complete!"
echo "─────────────────────────────────────────────────────────────────────────────"
echo "Now add these 6 secrets to GitHub:"
echo "👉 Go to: https://github.com/Meetifyyyy/Meetifyy/settings/environments"
echo "   Select or Create environment: 'development'"
echo "   Add these Environment Secrets:"
echo "   • AZURE_CLIENT_ID_DEV      = $CLIENT_ID"
echo "   • AZURE_TENANT_ID          = $TENANT_ID"
echo "   • AZURE_SUBSCRIPTION_ID    = $SUBSCRIPTION_ID"
echo "   • ACR_LOGIN_SERVER         = ${ACR_NAME}.azurecr.io"
echo "   • AZURE_RESOURCE_GROUP_DEV = $RESOURCE_GROUP"
echo "   • AZURE_CONTAINERAPP_DEV   = $APP_NAME"
echo "─────────────────────────────────────────────────────────────────────────────"
