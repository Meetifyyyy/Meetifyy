#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# Meetifyy — Automated Azure PROD Provisioning Script
# ─────────────────────────────────────────────────────────────────────────────

# Central India, not UAE North, for two reasons:
#
#   1. A subscription may hold only ONE Container Apps environment per region,
#      and dev already owns UAE North. Sharing that environment would put the
#      production app on the same internal network as dev - which is exactly
#      what the internal-only Redis ingress relies on for its isolation.
#
#   2. It is the better placement anyway: the production Supabase project is in
#      ap-south-1 (Mumbai), so this puts the backend beside its database
#      instead of ~1,900 km away.
#
# Allowed by this subscription's region policy (koreacentral, indiasouthcentral,
# uaenorth, malaysiawest, centralindia).
LOCATION="${LOCATION:-centralindia}"
RESOURCE_GROUP="meetifyy-prod-rg"
# Production owns its own registry, in the production resource group. It used
# to share "meetifyycr" with dev, which lives in meetifyy-dev-rg: deleting or
# locking down the dev group would have stopped production from pulling images.
ACR_NAME="${ACR_NAME:-meetifyyprodcr}"
# Overridable because a Log Analytics workspace name stays bound to the deleted
# workspace for a while after deletion: recreating the same name in a different
# region leaves ARM listing the resource while the Log Analytics provider still
# cannot resolve it. If that happens, set LOGS_WORKSPACE to a fresh name.
LOGS_WORKSPACE="${LOGS_WORKSPACE:-meetifyy-prod-logs-ci}"
ENV_NAME="meetifyy-prod-env"
APP_NAME="meetifyy-api"
REDIS_NAME="${REDIS_NAME:-meetifyy-prod-redis}"

ENV_FILE=""
SYNC_ONLY="false"

usage() {
  cat <<'USAGE'
Usage: ./setup-azure-prod.sh [--env-file PATH] [--sync-secrets]

  --env-file PATH   Read every production value from a dotenv file instead of
                    prompting. Use backend/.env.production, which is git-ignored
                    and holds the real values.

  --sync-secrets    Do not provision anything. Push the credentials from
                    --env-file onto the EXISTING production Container App and
                    restart it so they take effect immediately. This is the
                    command to run after rotating a key.

With no flags the script prompts for each value interactively, as before.
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --env-file) ENV_FILE="${2:-}"; shift 2 ;;
    --sync-secrets) SYNC_ONLY="true"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

if [ "$SYNC_ONLY" = "true" ] && [ -z "$ENV_FILE" ]; then
  echo "--sync-secrets requires --env-file." >&2
  exit 1
fi

# Reads one key from the dotenv file without sourcing it. Sourcing would execute
# whatever the file contains and would mangle values holding $, spaces or #.
#
# Quoting is handled before comment stripping, deliberately. A generated
# Postgres password may legitimately contain "#", and stripping comments first
# would silently truncate DATABASE_URL at that character - producing a valid
# looking but wrong credential, which is the worst possible failure here.
get_env() {
  [ -f "$ENV_FILE" ] || return 0
  ENV_FILE="$ENV_FILE" KEY="$1" node -e '
    const fs = require("fs");
    const key = process.env.KEY;
    for (const raw of fs.readFileSync(process.env.ENV_FILE, "utf8").split(/\r?\n/)) {
      const m = raw.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
      if (!m || m[1] !== key) continue;
      let v = m[2].trim();
      const q = v[0];
      if (q === "\"" || q === "\x27") {
        const end = v.indexOf(q, 1);
        // Everything after the closing quote is a comment, never part of the value.
        v = end === -1 ? v.slice(1) : v.slice(1, end);
      } else if (v.startsWith("#")) {
        // The whole value is an inline comment, i.e. the key was left blank.
        // Without this the placeholder text itself would be shipped to Azure
        // as if it were the credential.
        v = "";
      } else {
        v = v.replace(/\s+#.*$/, "").trim();
      }
      process.stdout.write(v);
      break;
    }
  '
}

echo "==> Meetifyy Production Provisioning"

if [ -n "$ENV_FILE" ]; then
  if [ ! -f "$ENV_FILE" ]; then
    echo "Env file not found: $ENV_FILE" >&2
    exit 1
  fi
  echo "Reading production values from $ENV_FILE"

  SUBSCRIPTION_ID="$(get_env AZURE_SUBSCRIPTION_ID)"
  TENANT_ID="$(get_env AZURE_TENANT_ID)"
  DATABASE_URL="$(get_env DATABASE_URL)"
  DIRECT_URL="$(get_env DIRECT_URL)"
  SUPABASE_URL="$(get_env SUPABASE_URL)"
  SUPABASE_ANON_KEY="$(get_env SUPABASE_ANON_KEY)"
  SUPABASE_SERVICE_ROLE_KEY="$(get_env SUPABASE_SERVICE_ROLE_KEY)"
  RESEND_API_KEY="$(get_env RESEND_API_KEY)"
  SMTP_HOST="$(get_env SMTP_HOST)"
  SMTP_PORT="$(get_env SMTP_PORT)"
  SMTP_USER="$(get_env SMTP_USER)"
  SMTP_PASS="$(get_env SMTP_PASS)"
  EMAIL_FALLBACK_DRIVER="$(get_env EMAIL_FALLBACK_DRIVER)"
  # Read-only key for the Brevo panel on the admin analytics page. Distinct from
  # SMTP_PASS: Brevo issues SMTP keys and API keys separately and an SMTP key
  # cannot call the REST API. Optional - absent means the panel reports "not
  # reporting" and mail delivery is unaffected.
  BREVO_API_KEY="$(get_env BREVO_API_KEY)"
  # Read-only service principal for the Azure panel, plus the app it reports on.
  # These name PRODUCTION resources only: dev is a different subscription in a
  # different tenant, so a dev value could not resolve here even by accident.
  AZURE_CLIENT_ID="$(get_env AZURE_CLIENT_ID)"
  AZURE_CLIENT_SECRET="$(get_env AZURE_CLIENT_SECRET)"
  AZURE_RESOURCE_GROUP="$(get_env AZURE_RESOURCE_GROUP)"
  AZURE_CONTAINER_APP="$(get_env AZURE_CONTAINER_APP)"
  R2_ACCESS_KEY_ID="$(get_env R2_ACCESS_KEY_ID)"
  R2_SECRET_ACCESS_KEY="$(get_env R2_SECRET_ACCESS_KEY)"
  R2_ACCOUNT_ID="$(get_env R2_ACCOUNT_ID)"
  R2_PUBLIC_URL="$(get_env R2_PUBLIC_URL)"
  R2_BUCKET_NAME="$(get_env R2_BUCKET_NAME)"
  R2_VERIFICATION_BUCKET_NAME="$(get_env R2_VERIFICATION_BUCKET_NAME)"
  SENTRY_DSN="$(get_env SENTRY_DSN)"
  ADMIN_JWT_ACCESS_SECRET="$(get_env ADMIN_JWT_ACCESS_SECRET)"
  ADMIN_JWT_REFRESH_SECRET="$(get_env ADMIN_JWT_REFRESH_SECRET)"
  ADMIN_JWT_PENDING_SECRET="$(get_env ADMIN_JWT_PENDING_SECRET)"
  REDIS_URL="$(get_env REDIS_URL)"
  SUPER_ADMIN_EMAIL="$(get_env SUPER_ADMIN_EMAIL)"
  SUPER_ADMIN_PASSWORD="$(get_env SUPER_ADMIN_PASSWORD)"

  # Azure identifiers are not part of the app's runtime config, so the env file
  # normally has no reason to carry them. Ask only for what is missing.
  [ -n "$SUBSCRIPTION_ID" ] || read -rp "Enter Production Azure Subscription ID: " SUBSCRIPTION_ID
  [ -n "$TENANT_ID" ] || read -rp "Enter Production Azure Tenant ID: " TENANT_ID

  # Fail before touching Azure rather than half-configuring the app. A blank
  # here means a required value was never filled in.
  MISSING=""
  for v in DATABASE_URL DIRECT_URL SUPABASE_URL SUPABASE_ANON_KEY \
           SUPABASE_SERVICE_ROLE_KEY RESEND_API_KEY R2_ACCESS_KEY_ID \
           R2_SECRET_ACCESS_KEY R2_ACCOUNT_ID R2_PUBLIC_URL; do
    eval "val=\${$v:-}"
    [ -n "$val" ] || MISSING="$MISSING $v"
  done
  if [ -n "$MISSING" ]; then
    echo "" >&2
    echo "These are still blank in $ENV_FILE:" >&2
    for v in $MISSING; do echo "  - $v" >&2; done
    exit 1
  fi

  # A placeholder that was never replaced would otherwise be written to Azure
  # as if it were a real credential.
  case "$DATABASE_URL$DIRECT_URL" in
    *"[YOUR-DB-PASSWORD]"*)
      echo "DATABASE_URL/DIRECT_URL still contain [YOUR-DB-PASSWORD]." >&2
      exit 1 ;;
  esac
else
  echo "Make sure you have your Production Supabase, R2, and Resend credentials ready."
  echo ""

  read -rp "Enter Production Azure Subscription ID: " SUBSCRIPTION_ID
  read -rp "Enter Production Azure Tenant ID: " TENANT_ID
  read -rsp "Enter Production Supabase DATABASE_URL (Transaction pooler, port 6543): " DATABASE_URL; echo
  read -rsp "Enter Production Supabase DIRECT_URL (Direct connection, port 5432): " DIRECT_URL; echo
  read -rp "Enter Production Supabase URL (https://<ref>.supabase.co): " SUPABASE_URL
  read -rp "Enter Production Supabase Anon Key: " SUPABASE_ANON_KEY
  read -rsp "Enter Production Supabase Service Role Key: " SUPABASE_SERVICE_ROLE_KEY; echo
  read -rsp "Enter Production Resend API Key: " RESEND_API_KEY; echo
  echo "Brevo SMTP fallback (optional — press Enter to skip each):"
  read -rp  "  SMTP_HOST (e.g. smtp-relay.brevo.com, blank to skip): " SMTP_HOST
  if [ -n "$SMTP_HOST" ]; then
    read -rp  "  SMTP_PORT (587): " SMTP_PORT
    SMTP_PORT="${SMTP_PORT:-587}"
    read -rp  "  SMTP_USER (Brevo login email): " SMTP_USER
    read -rsp "  SMTP_PASS (Brevo SMTP key): " SMTP_PASS; echo
    EMAIL_FALLBACK_DRIVER=smtp
  fi
  read -rsp "Enter Production R2 Access Key ID: " R2_ACCESS_KEY_ID; echo
  read -rsp "Enter Production R2 Secret Access Key: " R2_SECRET_ACCESS_KEY; echo
  read -rp "Enter Production R2 Account ID: " R2_ACCOUNT_ID
  read -rp "Enter Production R2 Public URL (e.g. https://cdn.meetifyy.app): " R2_PUBLIC_URL
  read -rp "Enter Production Sentry DSN (optional, press Enter to skip): " SENTRY_DSN
  read -rp "Enter Production Super Admin Email: " SUPER_ADMIN_EMAIL
  read -rsp "Enter Production Super Admin Password: " SUPER_ADMIN_PASSWORD; echo
fi

R2_BUCKET_NAME="${R2_BUCKET_NAME:-meetifyy-prod}"

# Admin JWT secrets. Generated only when the env file did not already supply
# them - regenerating on every run would silently invalidate every signed-in
# admin session and would drift from the value recorded in .env.production.
gen_secret() { node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"; }
ADMIN_JWT_ACCESS_SECRET="${ADMIN_JWT_ACCESS_SECRET:-$(gen_secret)}"
ADMIN_JWT_REFRESH_SECRET="${ADMIN_JWT_REFRESH_SECRET:-$(gen_secret)}"
ADMIN_JWT_PENDING_SECRET="${ADMIN_JWT_PENDING_SECRET:-$(gen_secret)}"

echo ""
echo "==> 1. Setting Azure Subscription..."
az account set --subscription "$SUBSCRIPTION_ID"

# ── Fast path: update credentials on the existing app and restart ────────────
if [ "$SYNC_ONLY" = "true" ]; then
  echo "==> Syncing credentials to $APP_NAME (no provisioning)..."

  if ! az containerapp show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1; then
    echo "Container App $APP_NAME does not exist yet. Run without --sync-secrets first." >&2
    exit 1
  fi

  # REDIS_URL is normally absent from the env file (the script owns it). Leaving
  # it out of the update keeps the existing secret rather than blanking it.
  SYNC_SECRETS=(
    "database-url=${DATABASE_URL}"
    "direct-url=${DIRECT_URL}"
    "supabase-url=${SUPABASE_URL}"
    "supabase-anon-key=${SUPABASE_ANON_KEY}"
    "supabase-service-role-key=${SUPABASE_SERVICE_ROLE_KEY}"
    "admin-jwt-access-secret=${ADMIN_JWT_ACCESS_SECRET}"
    "admin-jwt-refresh-secret=${ADMIN_JWT_REFRESH_SECRET}"
    "admin-jwt-pending-secret=${ADMIN_JWT_PENDING_SECRET}"
    "resend-api-key=${RESEND_API_KEY}"
    "r2-access-key-id=${R2_ACCESS_KEY_ID}"
    "r2-secret-access-key=${R2_SECRET_ACCESS_KEY}"
    "sentry-dsn=${SENTRY_DSN:-placeholder}"
    "super-admin-email=${SUPER_ADMIN_EMAIL:-placeholder}"
    "super-admin-password=${SUPER_ADMIN_PASSWORD:-placeholder}"
  )
  [ -n "${SMTP_PASS:-}" ] && SYNC_SECRETS+=("smtp-pass=${SMTP_PASS}")
  [ -n "${BREVO_API_KEY:-}" ] && SYNC_SECRETS+=("brevo-api-key=${BREVO_API_KEY}")
  # The client secret is the only Azure value that is a credential; the ids and
  # resource names below are not, and are set as plain env vars.
  [ -n "${AZURE_CLIENT_SECRET:-}" ] && SYNC_SECRETS+=("azure-client-secret=${AZURE_CLIENT_SECRET}")
  [ -n "${REDIS_URL:-}" ] && SYNC_SECRETS+=("redis-url=${REDIS_URL}")

  az containerapp secret set \
    --name "$APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --secrets "${SYNC_SECRETS[@]}" >/dev/null

  # Non-secret values live directly on the container, so they are set here too.
  az containerapp update \
    --name "$APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --set-env-vars \
      "R2_ACCOUNT_ID=${R2_ACCOUNT_ID}" \
      "R2_PUBLIC_URL=${R2_PUBLIC_URL}" \
      "R2_BUCKET_NAME=${R2_BUCKET_NAME}" \
      "R2_VERIFICATION_BUCKET_NAME=${R2_VERIFICATION_BUCKET_NAME:-}" \
      "EMAIL_FALLBACK_DRIVER=${EMAIL_FALLBACK_DRIVER:-}" \
      "SMTP_HOST=${SMTP_HOST:-}" \
      "SMTP_PORT=${SMTP_PORT:-587}" \
      "SMTP_USER=${SMTP_USER:-}" \
      "AZURE_SUBSCRIPTION_ID=${SUBSCRIPTION_ID:-}" \
      "AZURE_TENANT_ID=${TENANT_ID:-}" \
      "AZURE_CLIENT_ID=${AZURE_CLIENT_ID:-}" \
      "AZURE_RESOURCE_GROUP=${AZURE_RESOURCE_GROUP:-}" \
      "AZURE_CONTAINER_APP=${AZURE_CONTAINER_APP:-}" \
      "SUPER_ADMIN_EMAIL=secretref:super-admin-email" \
      "SUPER_ADMIN_PASSWORD=secretref:super-admin-password" >/dev/null
  [ -n "${AZURE_CLIENT_SECRET:-}" ] && az containerapp update \
    --name "$APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --set-env-vars "AZURE_CLIENT_SECRET=secretref:azure-client-secret" >/dev/null
  [ -n "${SMTP_PASS:-}" ] && az containerapp update \
    --name "$APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --set-env-vars "SMTP_PASS=secretref:smtp-pass" >/dev/null
  # Guarded for the same reason as SMTP_PASS: a secretref naming a secret that
  # was never created stops the container from starting at all, so an absent
  # optional key must leave the variable unset rather than dangling.
  [ -n "${BREVO_API_KEY:-}" ] && az containerapp update \
    --name "$APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --set-env-vars "BREVO_API_KEY=secretref:brevo-api-key" >/dev/null

  # Updating a secret does NOT restart the app, and a running replica keeps the
  # value it started with. Without this restart the new credentials sit in the
  # secret store unused until the next deploy.
  ACTIVE_REVISION=$(az containerapp show \
    --name "$APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --query properties.latestRevisionName --output tsv)

  az containerapp revision restart \
    --name "$APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --revision "$ACTIVE_REVISION" >/dev/null

  echo "Credentials synced and $ACTIVE_REVISION restarted."
  echo "Verify: az containerapp logs show --name $APP_NAME --resource-group $RESOURCE_GROUP --tail 50"
  exit 0
fi

echo "==> 2. Creating PROD Resource Group ($RESOURCE_GROUP)..."
if ! az group show --name "$RESOURCE_GROUP" >/dev/null 2>&1; then
  az group create --name "$RESOURCE_GROUP" --location "$LOCATION"
fi

echo "==> 2b. Creating Production Container Registry ($ACR_NAME)..."
# admin-enabled is deliberately OFF. The admin user is a static username and
# password that grants push and pull to everyone who holds it and cannot be
# scoped or attributed. Production pulls with the Container App's managed
# identity instead (step 5b), and CI pushes with its own federated identity.
if ! az acr show --name "$ACR_NAME" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1; then
  az acr create \
    --resource-group "$RESOURCE_GROUP" \
    --name "$ACR_NAME" \
    --sku Basic \
    --admin-enabled false \
    --location "$LOCATION"
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

echo "==> 4b. Provisioning Redis container ($REDIS_NAME) with persistent storage..."
# A self-hosted Redis container, deliberately, on a fixed student credit. The
# managed Azure Cache is the better product, but only its Standard tier (two
# replicated nodes) actually prevents the data loss that matters here - Basic is
# a single node with no persistence, so it loses exactly as much as this does on
# a restart. Rather than pay for Standard, this container is hardened against
# the two failure modes we can control ourselves.
#
# Redis here is not a cache. It holds five BullMQ queues - email, notifications,
# moderation, account-deletion, instant-match - plus admin sessions and
# rate-limit counters. Losing it silently drops OTP emails users are waiting on
# and deletion jobs the app has already confirmed.
#
# Two fixes over a bare `redis:7-alpine`:
#
#   1. OOM. The container is capped at 0.5Gi but Redis was never told, so it
#      grew until the platform killed it - a failure that arrives sooner the
#      more users you have. `maxmemory` now sits below the container limit, so
#      Redis enforces its own ceiling instead of being killed.
#
#   2. Restart amnesia. An Azure Files share mounted at /data gives RDB
#      snapshots somewhere that outlives the replica, so a restart reloads the
#      last snapshot instead of starting empty.
#
# RDB, not AOF: the share is SMB, and AOF's per-write fsync behaves poorly on
# it. Snapshots write one file occasionally, which SMB handles fine. The
# trade-off is a bounded loss window (below) rather than zero loss.

STORAGE_ACCOUNT="${STORAGE_ACCOUNT:-meetifyyprodredis}"
FILE_SHARE="redis-data"
STORAGE_MOUNT="redis-data-mount"

if ! az storage account show --name "$STORAGE_ACCOUNT" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1; then
  az storage account create \
    --name "$STORAGE_ACCOUNT" \
    --resource-group "$RESOURCE_GROUP" \
    --location "$LOCATION" \
    --sku Standard_LRS \
    --kind StorageV2 >/dev/null
fi

STORAGE_KEY=$(az storage account keys list \
  --account-name "$STORAGE_ACCOUNT" \
  --resource-group "$RESOURCE_GROUP" \
  --query "[0].value" --output tsv)

az storage share-rm create \
  --storage-account "$STORAGE_ACCOUNT" \
  --resource-group "$RESOURCE_GROUP" \
  --name "$FILE_SHARE" \
  --quota 1 >/dev/null 2>&1 || true

# Registers the share with the Container Apps environment so any app in it can
# mount the share by name.
az containerapp env storage set \
  --name "$ENV_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --storage-name "$STORAGE_MOUNT" \
  --azure-file-account-name "$STORAGE_ACCOUNT" \
  --azure-file-account-key "$STORAGE_KEY" \
  --azure-file-share-name "$FILE_SHARE" \
  --access-mode ReadWrite >/dev/null

if ! az containerapp show --name "$REDIS_NAME" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1; then
  # Created with flags, then patched. `az containerapp create --yaml` rejects a
  # hand-written document ("The JSON value could not be converted to
  # System.Boolean"), and the flags alone cannot express a volume mount or a
  # probe - so the app is created first, then its own exported spec is edited
  # and applied. Editing the live spec also guarantees the exact schema the API
  # expects rather than one reconstructed by hand.
  az containerapp create \
    --name "$REDIS_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --environment "$ENV_NAME" \
    --image redis:7-alpine \
    --target-port 6379 \
    --ingress internal \
    --transport tcp \
    --min-replicas 1 \
    --max-replicas 1 \
    --cpu 0.25 \
    --memory 0.5Gi \
    --command "redis-server" \
    -o none

  REDIS_LIVE="$(mktemp)"; REDIS_PATCH="$(mktemp)"
  az containerapp show --name "$REDIS_NAME" --resource-group "$RESOURCE_GROUP" -o yaml > "$REDIS_LIVE"

  REDIS_LIVE="$REDIS_LIVE" REDIS_PATCH="$REDIS_PATCH" python3 - <<'PYEOF'
import os, yaml
d = yaml.safe_load(open(os.environ['REDIS_LIVE']))
t = d['properties']['template']
c = t['containers'][0]

# Each flag is its own argv element. Passing them as one string makes
# redis-server receive a single unparsable argument and exit.
c['args'] = [
    # Below the 0.5Gi container cap, leaving room for Redis overhead and
    # fragmentation, so Redis refuses writes at its own ceiling instead of the
    # platform OOM-killing the process and losing the whole dataset.
    '--maxmemory', '320mb',
    # noeviction: these are queue jobs, not cache entries. Evicting one
    # silently deletes work a user was promised; a rejected write surfaces as
    # an error the app can retry.
    '--maxmemory-policy', 'noeviction',
    '--dir', '/data',
    '--dbfilename', 'dump.rdb',
    '--save', '60 100',
    '--save', '300 10',
    # A failed snapshot must not block every later write. On SMB a transient
    # write error is survivable; a frozen Redis is not.
    '--stop-writes-on-bgsave-error', 'no',
]
c['volumeMounts'] = [{'volumeName': 'redis-data', 'mountPath': '/data'}]
# Catches a hung-but-alive Redis, which a bare container would serve forever.
c['probes'] = [{
    'type': 'Liveness',
    'tcpSocket': {'port': 6379},
    'initialDelaySeconds': 15,
    'periodSeconds': 30,
    'failureThreshold': 3,
}]
t['volumes'] = [{'name': 'redis-data', 'storageType': 'AzureFile',
                 'storageName': 'redis-data-mount'}]

# Read-only fields the update API rejects.
for k in ('latestReadyRevisionName', 'latestRevisionFqdn', 'latestRevisionName',
          'outboundIpAddresses', 'eventStreamEndpoint', 'customDomainVerificationId',
          'provisioningState', 'runningStatus', 'delegatedIdentities'):
    d['properties'].pop(k, None)
d['properties']['configuration']['ingress'].pop('fqdn', None)

yaml.safe_dump(d, open(os.environ['REDIS_PATCH'], 'w'),
               default_flow_style=False, sort_keys=False)
PYEOF

  az containerapp update \
    --name "$REDIS_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --yaml "$REDIS_PATCH" -o none
  rm -f "$REDIS_LIVE" "$REDIS_PATCH"
fi

# No password: ingress is internal, so the listener is reachable only from
# inside this Container Apps environment - not the internet, and not from the
# dev environment, which is separate. Redis AUTH over a plaintext internal hop
# would add a secret to manage without adding a boundary.
REDIS_URL="redis://${REDIS_NAME}:6379"

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
    EMAIL_FALLBACK_DRIVER="${EMAIL_FALLBACK_DRIVER:-}" \
    SMTP_HOST="${SMTP_HOST:-}" \
    SMTP_PORT="${SMTP_PORT:-587}" \
    SMTP_USER="${SMTP_USER:-}" \
    STORAGE_PROVIDER=r2 \
    R2_ACCOUNT_ID="$R2_ACCOUNT_ID" \
    R2_PUBLIC_URL="$R2_PUBLIC_URL" \
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
    "sentry-dsn=${SENTRY_DSN:-placeholder}" \
    "super-admin-email=${SUPER_ADMIN_EMAIL:-placeholder}" \
    "super-admin-password=${SUPER_ADMIN_PASSWORD:-placeholder}" \
    ${SMTP_PASS:+"smtp-pass=${SMTP_PASS}"} \
    ${BREVO_API_KEY:+"brevo-api-key=${BREVO_API_KEY}"}

echo "==> 5b. Creating the shared pull identity and granting it AcrPull..."
# A USER-assigned identity, not a system-assigned one, because two different
# resources pull the same image: the Container App, and the short-lived
# Container App Job that CI creates for `prisma migrate deploy`. A
# system-assigned identity belongs to one resource and dies with it, so the
# migration job would need its own AcrPull grant on every deploy and would race
# the few seconds of role-assignment propagation. One durable identity, granted
# once, removes that race.
IDENTITY_NAME="${IDENTITY_NAME:-meetifyy-prod-pull}"

if ! az identity show --name "$IDENTITY_NAME" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1; then
  az identity create --name "$IDENTITY_NAME" --resource-group "$RESOURCE_GROUP" --location "$LOCATION"
fi

IDENTITY_ID=$(az identity show --name "$IDENTITY_NAME" --resource-group "$RESOURCE_GROUP" \
  --query id --output tsv)
IDENTITY_PRINCIPAL_ID=$(az identity show --name "$IDENTITY_NAME" --resource-group "$RESOURCE_GROUP" \
  --query principalId --output tsv)

ACR_ID=$(az acr show --name "$ACR_NAME" --resource-group "$RESOURCE_GROUP" \
  --query id --output tsv)

# AcrPull is read-only: production can pull images, never push them.
az role assignment create \
  --assignee-object-id "$IDENTITY_PRINCIPAL_ID" \
  --assignee-principal-type ServicePrincipal \
  --role AcrPull \
  --scope "$ACR_ID" >/dev/null || true

az containerapp identity assign \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --user-assigned "$IDENTITY_ID" >/dev/null

az containerapp registry set \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --server "${ACR_NAME}.azurecr.io" \
  --identity "$IDENTITY_ID" >/dev/null

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
    "SENTRY_DSN=secretref:sentry-dsn" \
    "SUPER_ADMIN_EMAIL=secretref:super-admin-email" \
    "SUPER_ADMIN_PASSWORD=secretref:super-admin-password"
[ -n "${SMTP_PASS:-}" ] && az containerapp update \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --set-env-vars "SMTP_PASS=secretref:smtp-pass" > /dev/null
[ -n "${BREVO_API_KEY:-}" ] && az containerapp update \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --set-env-vars "BREVO_API_KEY=secretref:brevo-api-key" > /dev/null

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

# CI pushes to the production registry; it never needs pull-from-dev rights.
az role assignment create \
  --assignee "$PROD_CLIENT_ID" \
  --role AcrPush \
  --scope "$ACR_ID" || true

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
echo "  AZURE_ACR_IDENTITY_PROD   = $IDENTITY_ID"
echo ""
echo "NOTE: ACR_LOGIN_SERVER changed. Production now uses its own registry"
echo "      (${ACR_NAME}.azurecr.io) in $RESOURCE_GROUP, not the dev one."
echo "      Set it on the GitHub *production* environment only - leave the"
echo "      repo-level/dev value alone or you will retarget dev deploys."
echo ""
echo "Redis: $REDIS_NAME - self-hosted container, 320mb maxmemory, noeviction,"
echo "      RDB snapshots on an Azure Files share (${STORAGE_ACCOUNT}/${FILE_SHARE})."
echo "      A restart now reloads the last snapshot instead of starting empty."
echo "      Worst case on an unclean stop is the snapshot window (60s/100 keys)."
echo ""
echo "      Before any planned change to it, drain the queues first:"
echo "        az containerapp revision restart -n $APP_NAME -g $RESOURCE_GROUP --revision <rev>"
echo "      and do it when traffic is low - queued email/deletion jobs live here."
echo "─────────────────────────────────────────────────────────────────────────────"
