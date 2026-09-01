# Azure setup

Two **separate Azure subscriptions on two different Microsoft accounts**. This
is not tidiness — it is forced. An Azure subscription may hold only **one
Container Apps environment**, globally. Dev owns the one in its subscription, so
production physically cannot share it.

| | development | production |
|---|---|---|
| Account | `sarthak.08saini@gmail.com` | `sarthaksaini208@gmail.com` |
| Subscription | `4f4979b4-2a88-469a-9347-e53f4ae83005` | `06a4a60e-ef30-44c0-95ed-e01cdad6a232` |
| Tenant | `7339fc19-f2ee-4b86-adc9-ecd6d13b1a4d` | `1284de5d-114c-4539-9fc0-14723c1b767a` |
| Resource group | `meetifyy-dev-rg` | `meetifyy-prod-rg` |
| Region | UAE North | **Central India** |
| Registry | `meetifyycr` (admin user **on**) | `meetifyyprodcr` (admin user **off**) |
| Container Apps env | `meetifyy-dev-env` | `meetifyy-prod-env` |
| API app | `meetifyy-api-dev` | `meetifyy-api` |
| Redis | `meetifyy-redis-dev` | `meetifyy-prod-redis` |
| Logs | `meetifyy-dev-logs` | `meetifyy-prod-logs-ci` |
| Pull identity | — | `meetifyy-prod-pull` (user-assigned) |
| Redis persistence | none | Azure Files (`meetifyyprodredis`) |

Production sits in **Central India** because the production Supabase project is
in `ap-south-1` (Mumbai). That puts the backend beside its database instead of
~1,900 km away in UAE North. Both subscriptions restrict deployments by policy
to `koreacentral, indiasouthcentral, uaenorth, malaysiawest, centralindia`.

## How production differs from development

Production is not a copy of dev — three things were deliberately hardened.

**The registry has its admin user disabled.** The ACR admin user is a static
username and password granting push and pull to anyone holding it, and it cannot
be scoped or attributed. Production instead pulls with a **user-assigned managed
identity** (`meetifyy-prod-pull`) holding `AcrPull` — read-only, revocable by
removing one role assignment, with no password stored on the app.

It is *user*-assigned rather than system-assigned because two resources pull the
same image: the Container App, and the short-lived Container App Job that CI
creates for `prisma migrate deploy`. A system-assigned identity dies with its
resource, so the job would need a fresh grant every deploy and would race
role-assignment propagation.

**Redis is hardened.** Both environments self-host `redis:7-alpine` rather than
paying for Azure Cache. Production adds:

- `maxmemory 320mb`, below the 0.5Gi container cap. Previously Redis was never
  told about the cap, so it grew until the platform OOM-killed it — a failure
  that arrives *sooner the more users you have*.
- `maxmemory-policy noeviction`. These are queue jobs, not cache entries:
  evicting one silently deletes work a user was promised.
- RDB snapshots to an **Azure Files** share at `/data`, so a restart reloads the
  last snapshot instead of starting empty. RDB rather than AOF because SMB
  handles occasional whole-file writes far better than per-write fsync.
- A **liveness probe**, which catches a hung-but-alive Redis.

Residual risk: an unclean stop still loses the snapshot window (60s/100 keys).
Only Standard-tier managed Redis removes that, via replication — Basic tier has
no persistence either and would lose exactly as much.

**Production owns its registry.** Dev and prod previously shared `meetifyycr`,
which lives in `meetifyy-dev-rg` — so deleting or locking down the dev group
would have stopped production pulling images.

## Provisioning

```bash
./setup-azure-prod.sh --env-file backend/.env.production
```

Reads every value from the env file instead of prompting, validates them all
before touching Azure, and refuses to run if anything is blank or still holds a
placeholder. It creates the resource group, ACR, log workspace, Container Apps
environment, Redis with its storage share, the pull identity, the Container App
with all secrets wired as `secretref`, the GitHub OIDC service principal, and
its federated credentials — then prints the GitHub secrets.

To push changed credentials to an already-provisioned app:

```bash
./setup-azure-prod.sh --env-file backend/.env.production --sync-secrets
```

This is the credential-rotation command. It restarts the active revision,
because updating a Container App secret does **not** restart it and a running
replica keeps the value it booted with.

## Moving production to a different Azure account

The script is tenant-agnostic — it prompts for subscription and tenant rather
than hardcoding them, so no code changes are needed. Only `setup-azure-dev.sh`
hardcodes IDs, and that is correct: dev stays where it is.

1. **Log in. Do not log out of the old one.**
   ```bash
   az login                      # adds the account; both stay available
   az account list --all --query "[].[user.name,id,tenantId]" -o tsv
   ```

2. **Pre-flight the new subscription** — these are the three things that
   actually block a move:
   ```bash
   az account set --subscription <NEW_SUB_ID>
   az containerapp env list --query 'length(@)' -o tsv        # must be 0
   az policy assignment list \
     --query "[?displayName=='Allowed resource deployment regions'].parameters.listOfAllowedLocations.value[]" -o tsv
   az ad sp create-for-rbac --name preflight-test --role Reader \
     --scopes /subscriptions/<NEW_SUB_ID>                     # must succeed
   ```
   A brand-new subscription also has no resource providers registered:
   ```bash
   for p in Microsoft.App Microsoft.ContainerRegistry \
            Microsoft.OperationalInsights Microsoft.Storage; do
     az provider register -n $p
   done
   ```
   The service-principal test is the one most likely to fail. If the
   subscription sits in a **university** tenant rather than a personal one,
   students usually cannot create app registrations — and without that there is
   no GitHub OIDC and no automated deploys.

3. **Free the globally-unique names.** ACR and storage account names are unique
   across all of Azure. Delete the old `meetifyy-prod-rg` (or override
   `ACR_NAME` / `STORAGE_ACCOUNT`) before provisioning, or creation fails with
   "name already taken".

4. **Provision** with `--env-file` as above, giving the new subscription and
   tenant.

5. **Update GitHub → Environments → `Production`** with the new
   `AZURE_SUBSCRIPTION_ID`, `AZURE_TENANT_ID`, `AZURE_CLIENT_ID_PROD`,
   `ACR_LOGIN_SERVER`, `AZURE_RESOURCE_GROUP_PROD`, `AZURE_CONTAINERAPP_PROD`
   and `AZURE_ACR_IDENTITY_PROD`. **Leave `development` untouched** — it holds
   the same secret *names* with the other account's values, which is exactly why
   the two sets must live in separate GitHub environments.

6. **Re-point DNS.** `api.meetifyy.app` must CNAME to the new Container App
   FQDN, and the custom domain must be bound in the new app.

## Custom domain for the API

Order matters; getting it wrong produces Cloudflare **Error 1000**.

1. Get the FQDN:
   ```bash
   az containerapp show -n meetifyy-api -g meetifyy-prod-rg \
     --query 'properties.configuration.ingress.fqdn' -o tsv
   ```
2. Cloudflare → `meetifyy.app` → DNS → add **CNAME** `api` → that FQDN, set to
   **DNS only (grey cloud)**. Never an A record pointing at a Cloudflare IP —
   that is precisely what triggers Error 1000.
3. Azure Portal → `meetifyy-api` → Custom domains → bind `api.meetifyy.app` with
   a managed certificate. This cannot validate while the record is proxied.
4. Verify the Azure FQDN first, then the custom domain — both must return 200:
   ```bash
   curl -sS -o /dev/null -w '%{http_code}\n' https://<AZURE_FQDN>/health
   curl -sS -o /dev/null -w '%{http_code}\n' https://api.meetifyy.app/health
   ```
   If the first fails, the problem is the container or the ingress `targetPort`,
   not DNS.
5. *Optionally* switch to proxied (orange) and set SSL/TLS to **Full (strict)**.
   Worth doing — it hides the Azure IP and helps on college networks that block
   Azure ranges — but only after step 4 passes, and re-run step 4 afterwards.

## Rollback

```bash
az acr repository show-tags --name meetifyyprodcr --repository meetifyy-api \
  --output table | grep prod-
az containerapp update -n meetifyy-api -g meetifyy-prod-rg \
  --image meetifyyprodcr.azurecr.io/meetifyy-api:prod-<PREVIOUS_SHA>
```

This rolls back **code only**. Migrations are not reverted, which is why they
must be backward-compatible with the previous release.

## Cost

Both subscriptions are Azure for Students: a fixed credit and **no card on
file**, so they cannot overspend — they simply stop. The credit also expires
after 12 months, which for production is a hard date when it needs converting
to pay-as-you-go or the site goes down.
