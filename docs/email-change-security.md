# Email change security

How Settings → Email (sign-in email) and the Campus college email are
protected: fresh reauthentication, ownership proof, independent 30-day
cooldowns, and a database guard on Supabase Auth's own email-change path.

## The three operations

| Operation | Reauth grant purpose | Ownership proof | Cooldown |
|---|---|---|---|
| Change sign-in (personal) email | `personal_email_change` | 6-digit code to the **new** address | personal, 30 × 24 h |
| Add / change college email | `college_email_change` (not for an account's first-ever one) | 6-digit code to the college address, on an ACTIVE domain of that college | college, 30 × 24 h |
| Remove college email | `college_email_remove` | — | never blocked; restarts the college cooldown |

The two cooldowns are separate rows in `EmailChangeEvent`; neither moves the
other. Super Admin revoke / reset are recorded (`ADMIN_REVOKE`,
`ADMIN_RELEASE`) but start no cooldown and are never blocked by one.

## Reauthentication grants

`/api/account/reauth` (`account-security/reauth.*`):

- `GET` → `{ methods }`: `password` when the Supabase user has an `email`
  identity, otherwise `email_code` (OAuth / passwordless accounts), which sends
  a code to the **current** sign-in address. A password account cannot use the
  email path.
- `POST /password`, `POST /code`, `POST /code/verify` → `{ reauthToken, expiresAt }`.

A grant is 256 random bits; only its SHA-256 is stored (`ReauthGrant`). It is
bound to the user, the purpose, the session id (the `<prefix>_sid`
cookie, or `x-session-id` from the app), and the address its live code was
sent to (bound only after that code is issued, so "use a different email"
needs no second prompt and a refused resend cannot move it). It lives 10
minutes, one live grant per (user, purpose), and is spent by a conditional update inside
the transaction that applies the change (so exactly one concurrent request can
spend it, and a rolled-back change leaves it spendable). The server never
accepts a flag, a timestamp or an existing session as proof.

Password checks go through `AuthService.verifyPassword` (Supabase) and spend
the `auth.verifypassword.user` budget (5 / 15 min, fails closed without
Redis): on `/reauth/password`, and inside the services for the legacy password
bodies below. A verify or removal that carries a grant guesses no password and
spends none; code guesses are capped per code and per IP by `UserOtpService`.

Independent pre-checks run in parallel (`allChecks`), and when several fail
the first listed wins, so a refused request always gets the same answer.

In the UI, Settings asks "confirm it's you" as soon as the change form opens
(`reauthFirst`); the profile-completion card asks only on "Send code", so the
app never opens a password dialog unprompted.

### Installed apps that predate grants

The oldest builds send `{ code, currentPassword }` to
`/api/account/email/verify` and `{ password }` to `DELETE /api/campus/affiliation`.
Both are still accepted: the password is re-checked at that commit point, which
is a fresh reauthentication. Old builds **cannot change a college email** any
more (they send no credential, so the server answers `reauth_required` with a
readable message). First-time Campus verification still works on them.

## Cooldown enforcement

`EmailChangePolicyService`:

- Every completing write locks the user row (`SELECT … FOR UPDATE`), re-checks
  the cooldown against `timezone('utc', now())`, applies the change and appends
  the event — one transaction. Two devices therefore serialise; the second is
  refused.
- The cooldown is also checked before any code is sent and before a code is
  consumed, so a doomed attempt costs no code.
- Nothing is recorded for a failed, abandoned, expired or rolled-back attempt.
- Accounts with no history are eligible.

## The sign-in email and Supabase Auth

A signed-in client holds a Supabase access token and the public anon key, so it
could call `PUT /auth/v1/user {"email": …}` directly and skip all of the above.
Supabase has no setting that disables user-initiated email changes, so
migration `00000000000029_email_change_security` installs a `BEFORE UPDATE`
trigger on `auth.users` (`meetifyy_guard_auth_email_change`) that:

1. refuses any non-empty write to `email_change` (where GoTrue stages a
   self-service change before its confirmation mail), and
2. refuses any change of `email` unless a live `AuthEmailChangeIntent` row
   names exactly that address for that user.

The backend flow (`AccountEmailService.verify`): lock → re-check cooldown,
uniqueness, in-flight intent → spend grant → write a 60-second intent → commit
→ `auth.admin.updateUserById` → lock → `User.email` + event + delete intent →
commit → enqueue the notice to the **previous** address (job id = event id, 5
attempts with backoff). If the row write fails the auth email is restored
(under a fresh intent). If the admin call errors in a way that may still have
applied (a timeout), the intent is kept: once it expires, `reconcile()` reads
Supabase and finishes the change or clears it. The same happens after a
crash between the two halves. A duplicate completion is a no-op because the
intent is gone, and a request that finds the reconciler already finished its
change returns success instead of undoing it. The intent cascades with the
account, so a deletion mid-change leaves no addresses behind.

The profile `PATCH /api/users/me` never writes `email`, and the auth sync path
writes it only when creating a new account.

## Deployment checklist

1. **Confirm the trigger exists after the migration runs**, in each project:

   ```sql
   SELECT tgname FROM pg_trigger
   WHERE tgrelid = 'auth.users'::regclass
     AND tgname = 'meetifyy_guard_auth_email_change';
   ```

   If the migrating role could not create it, the migration still succeeds
   (with a `WARNING`) so it cannot block later migrations, and the API logs an
   `ERROR` from `AuthEmailGuardCheck` at boot. Install it from the SQL editor
   by re-running the `DO $$ … $$` block at the end of the migration.
2. **Smoke-test the bypass in development** with a test account: call
   `PUT https://<dev-ref>.supabase.co/auth/v1/user` with the account's access
   token and `{"email":"x@example.com"}`. Expect an error response and no
   confirmation email; the account's email must be unchanged.
3. Nothing to change in Supabase Auth settings, the email provider, or
   environment variables.

## Testing

- Unit: `account-email.service.spec.ts`, `campus-affiliation.service.spec.ts`
  (grants and cooldowns stubbed).
- Database-backed: `account-security/email-change.db.spec.ts` runs the real
  services against Postgres with the migrations applied and a Supabase-shaped
  `auth.users` (`id uuid, email text, email_change text, last_sign_in_at`) plus
  the `anon`, `authenticated` and `supabase_auth_admin` roles. Auth writes run
  as `supabase_auth_admin`, so the trigger judges them as in Supabase. It runs
  only when `DATABASE_URL` and `EMAIL_SECURITY_TEST_DATABASE_URL` are the same
  localhost URL; never point it at a shared database. Use `connection_limit=1`
  for single-connection servers such as PGlite.

## Known limits

- Verified against Postgres, not against a live GoTrue: the exact HTTP error a
  client gets from `PUT /auth/v1/user` when the trigger refuses is GoTrue's
  (`Database error updating user`).
- No OAuth provider is configured today, so `email_code` reauthentication is
  exercised only in tests.
- Changing an email does not sign out other sessions (unchanged behaviour).
