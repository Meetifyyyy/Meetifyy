# Working rules for AI agents in this repository

These are not style preferences. Every rule below exists because the failure it
prevents has already happened here, or because the code actively enforces it and
working around it breaks a real guarantee.

If a rule blocks you, **stop and ask**. Do not route around it.

---

## 1. Production is off limits

**Never write to the production database.** Not through the Supabase MCP, not
through `psql`, not through a script, not "just this once" to fix data.

The production schema is owned entirely by `prisma migrate deploy`, run by CI as
a Container App Job. Creating tables or altering columns by hand leaves Prisma's
`_prisma_migrations` table out of sync, so the next deploy tries to apply a
migration against objects that already exist, fails, and leaves someone
hand-baselining migration history on a live database.

The same applies to **production environment variables**. Do not edit
`backend/.env.production`, the two frontend `.env.production` files, or Azure
Container App secrets unless the user explicitly asks for that specific change.
They hold live credentials; a wrong value is an outage, and a value pasted into
the wrong environment is a cross-environment leak.

**Never run `setup-azure-prod.sh` (with or without `--sync-secrets`), bind a
domain, or delete an Azure resource without being asked.** These are billed,
outward-facing and hard to reverse.

## 2. Development and production never touch

They are separate on purpose, at every layer:

| | development | production |
|---|---|---|
| Azure subscription | `4f4979b4…` | `06a4a60e…` (different Microsoft account) |
| Supabase project | Meetfiyy DEV (Singapore) | Meetifyy (Mumbai) |
| Cloudflare account | dev | **separate account** |
| Redis | `meetifyy-redis-dev` | `meetifyy-prod-redis` |
| GitHub environment | `development` | `Production` |
| Branch | `development` | `main` |

Rules that follow from that:

- **Never copy a value from one environment into the other.** Not a database
  URL, not an API key, not an R2 credential. Production secrets are generated
  fresh, never promoted from dev.
- **Never point a production resource at a dev one, or vice versa.**
  `src/config/isolation.guard.ts` will refuse to boot if you do — but it only
  inspects *hostnames*, so a correctly named resource belonging to the wrong
  environment still passes. The guard is a backstop, not permission to be
  careless.
- **Never share Redis between environments.** They would share one keyspace: a
  dev worker could execute a production job, and a `FLUSHALL` while debugging
  dev would wipe production sessions and queues.
- **`setup-azure-dev.sh` is not a template for production.** Dev enables the ACR
  admin user and has no Redis persistence; production must not.

## 3. Supabase MCP

Point the MCP at **development**. Production MCP access should be connected only
for a specific, stated reason and disconnected afterwards.

`execute_sql` and `apply_migration` look identical whether they target dev or
production — the only difference is a project ref inside the call, which is not
visible in an approval prompt. Never have both a dev and a prod Supabase MCP
server enabled in the same session.

The rule: **development is where an agent may write; production is where CI
writes and everyone else reads.**

`isolation.guard.ts` protects the *server*. It cannot see an MCP call, which
reaches the database directly.

## 4. Secrets

- Only `*.example` files are ever committed. `.gitignore` denies `.env`,
  `.env.*`, `*.env` and `*.env.*` and re-includes only the examples.
- **Before any commit that touches config or docs, grep the diff for live
  values.** A production database password once reached a docs file as an
  "example" and was caught only by a pre-push scan. Check for connection
  strings, `eyJ…` JWTs, `sb_secret_…`, `re_…` and 32-hex account IDs.
- Never print a secret into the terminal, a log, a commit message, or a
  document. When you must show one, mask it.
- Never put a secret in a `VITE_` variable. Those are inlined into the browser
  bundle at build time and are public by definition.
- Never add a real credential to a `.example` file.

## 5. Database changes

- **Never `prisma db push`.** It force-matches the database to the schema and
  drops whatever does not match, including columns holding user data, with no
  migration to review and no rollback.
- `prisma migrate dev` is local-only. Against a drifted database it offers to
  reset (wipe) it.
- Commit `schema.prisma` and the generated `migrations/` folder **together**. A
  schema change without its migration never reaches production, and the app
  boots expecting a column that is not there.
- **Every migration must be backward-compatible with the previous release**,
  because a rollback reverts the image but not the schema.

## 6. CI/CD owns deployment

Nothing is deployed by hand. `push → CI → build → migrate → deploy → health
check`, triggered by merging to `development` or `main`.

- Do not run `az containerapp update` to ship code. Use the pipeline.
- The production database URL is read from the Container App's own secret store
  at deploy time and **never becomes a GitHub secret**. Any change to the
  pipeline must preserve that.
- Migrations run **before** the new image is deployed, so the schema is always
  ahead of or equal to the running code.
- `development` and `Production` GitHub environments hold secrets with the same
  *names* and different *values*. Never merge them into repo-level secrets, and
  never edit one environment's secrets while intending the other.
- Changing the `environment:` key in a workflow changes the OIDC token subject
  and will break Azure login. It is not a cosmetic rename.

## 7. Git

- **The user is the only author.** Never add `Co-Authored-By`, "Generated with",
  or any other attribution trailer to a commit or PR.
- Never force-push a shared branch. Never rewrite history that has been pushed.
- Never commit directly to `main`; it deploys to production.
- Do not push, merge, or open a PR unless asked.

## 8. Do not weaken security to make something work

If a change requires disabling a protection, stop and explain the trade-off
instead. In particular, do not:

- add `*` to `CORS_ORIGINS` — the API is credentialed, and the isolation guard
  rejects it at boot;
- disable CSP or HSTS in production;
- set `R2_VERIFICATION_BUCKET_NAME` to the public bucket, or give that bucket a
  public host — it holds identity documents;
- change `maxmemory-policy` away from `noeviction` on Redis — those are queue
  jobs, and evicting one silently deletes work a user was promised;
- enable the ACR admin user on production;
- use `Math.random` for anything that is a token, id, secret or lock value;
- add `pgbouncer=true` or `sslmode=require` to the database URLs — see
  `docs/operations.md` for why each breaks this specific stack.

## 9. Verify, then report honestly

- Prefer reading the code over assuming. Config lives in `backend/src/config/`;
  `env.ts` is the only file that reads `process.env`.
- Run the tests. `cd backend && npx jest` — the suite is fast and green.
- If something failed, say so with the output. If you skipped part of a task,
  say which part and why. Do not report success you have not verified.
- Distinguish a real finding from a false positive, and say which it is.

---

Further detail: [docs/operations.md](docs/operations.md) for failure modes,
[docs/azure-setup.md](docs/azure-setup.md) for infrastructure,
[docs/project-structure.md](docs/project-structure.md) for how the environments
differ.
