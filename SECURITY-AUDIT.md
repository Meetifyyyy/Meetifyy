# Meetifyy Security Audit & Remediation

**Date:** 2026-09-09 · **Scope:** 313 backend endpoints, 66k lines backend, 105k frontend, admin portal, realtime gateway, storage, deployment config, dependencies, git history.

**Result:** 10 commits. Every finding from the audit is fixed, except two that are staged in report-only because they cannot be verified without a browser, and one that needs an infrastructure action rather than code.

**Tests:** backend 2046 passing (144 suites), frontend 1225 passing (115 files). ~90 of these are new and written specifically at the security boundaries below.

---

## Fixed

### 1. User sessions were unrevocable — **CRITICAL**
`UserSession` model · `auth/session/*` · `jwt.guard.ts` · `supabase.js` · `apiClient.js`

An access token was a pure bearer credential with nothing behind it. Nothing recorded that a device was signed in, so nothing could sign it out. Tokens — **including the refresh token** — sat in `localStorage`, readable by any script on the origin, and a copy lifted from a device kept minting new access tokens until it expired. Logout cleared one browser.

Now: a session row per device; access and refresh in **HttpOnly** cookies (refresh path-scoped so it travels rarely); Supabase's own refresh token moved server-side and **sealed with AES-256-GCM**, so the table is inert to anyone reading the database. Refresh **rotates**, and a token presented twice burns the whole family — the server cannot tell which holder is legitimate, so both sign in again. Device list, "sign out this device", "sign out everywhere". Password change revokes our sessions as well as Supabase's; previously only half the state came down. Tokens left in `localStorage` by earlier versions are purged on load, because changing where new sessions go does nothing about the one already on every existing user's disk.

### 2. SSRF to cloud metadata — **HIGH**
`link-preview.service.ts`

Mapped IPv6 was screened by a prefix list covering three private ranges. `::ffff:169.254.169.254` — the metadata endpoint — read as public and was fetched; the previewed host serves its own DNS, so it can answer in mapped form. `100.64.0.0/10` was unblocked in both branches (Alibaba's metadata is at `100.100.100.200`). Mapped addresses are now normalised so ranges are defined once. **Verified the 5 payloads passed pre-fix and are blocked after.**

### 3. Realtime rooms joined without authorization — **HIGH**
`realtime.gateway.ts`

`post:join` and `community:join_room` took the ID from the client and joined unconditionally. The post room carries `comment.created` — **comment body and author** — so any authenticated socket could read comments on posts whose REST route returns 404 for that viewer. Both now apply the same denial set `getPostById` uses and fail closed. **6 of 9 new tests fail against the old handlers.**

### 4. Conversation attachments were public — **HIGH**
`uploads.service.ts` · `uploads.controller.ts` · `cloudflare-r2.provider.ts`

Chat/voice/message media was served to anyone with the URL — forever, after deletion, unrevocable. Fixed at four layers, because three are individually bypassable: the media route authorizes participation; uploads are born private; signed URLs authorize **participants, not just owners** (ownership alone would have blanked every recipient's images); and objects move to the bucket with no public host — without that last one the rest is decoration, since `cdn.meetifyy.app` resolves any key unauthenticated.

This was only possible *after* the cookie migration: an `<img>` tag cannot send an Authorization header.

### 5. Vulnerable dependencies — **HIGH**
11 advisories, all but one transitive from **multer 2.2.0**, including a file-size-limit bypass reachable from the upload endpoints. `npm audit fix --force` would have downgraded NestJS four majors; a same-major override fixes the chain. nodemailer 9.0.3 → 9.1.1. **11 → 1** (js-yaml via ESLint, dev-only).

### 6. Account enumeration — **MEDIUM**
`request-password-reset` returned `exists`. Rate limiting bounds volume, not targeting: one request answered "is this person on Meetifyy?" for any address. Every outcome — missing account, real account, mail failure — now returns `{ sent: true }`. Username/email availability are untouched; a signup form cannot work without them.

### 7. Smaller findings — **MEDIUM/LOW**
- `unsafe-eval` removed from CSP (verified: no `eval`/`new Function` in 103 built assets; the one `Function("return this")` is the globalThis polyfill behind a short-circuit), `object-src 'none'` added
- Admin OTP was unsalted `sha256` — a million possibilities, trivially reversed from a table dump, on your highest-privilege accounts. Now keyed HMAC, constant-time compare
- Admin CSRF compared with `!==` → constant-time
- Admin bcrypt cost 10 → 12
- `/admin/auth/refresh` was the only unmetered admin auth route
- `OptionalJwtGuard` read `cookies.access_token`, a name nothing ever wrote — cookie-authenticated callers looked anonymous

---

## Staged, not enforced — needs one browser pass

Both ship as `Content-Security-Policy-Report-Only` beside the enforced policy. Browsers evaluate and report; nothing is blocked.

| | Why not enforced |
|---|---|
| **`script-src` without `unsafe-inline`** | Needs hashes of inline scripts *after* the build, which transforms them (4 → 3, none byte-identical). One is the launch-time version gate that decides whether the app loads at all — a drifted hash is a blank page for every user. It carries `__MEETIFYY_BUILD_VERSION__`, so it cannot be moved to `public/` to avoid hashing. |
| **`connect-src` narrowed to named hosts** | Currently allows `http:`/`https:` outright, so CSP cannot constrain exfiltration. Narrowing depends on the full runtime host set; miss one and uploads or sign-in break in production. |

**To finish:** load the app in a browser, exercise login, upload, chat and realtime, and watch the console for CSP violations. Clean → copy the report-only value over the enforced one and delete the report-only header. Tests already pin that the candidate cannot drift weaker than what is enforced.

---

## Needs an infrastructure action

**Chat media uploaded before commit `bc60f39` is already on the public CDN** and stays reachable by URL. New uploads go to the private bucket; old objects do not move themselves. Closing it means copying those objects into the private bucket and repointing their `media` rows, or removing the bucket's public host.

**Also:** confirm the old Supabase project `aqeivtmrdyabfaddpjon` is deleted. Its anon key is in git history (commit `6f117e2`, removed in `770c257`). An anon key is public by design and it is not the current project, so this is low severity — but a live project behind it with weak RLS would not be.

---

## Verified clean

SQL injection (every raw query is a static literal) · mass assignment (`whitelist` + `forbidNonWhitelisted` globally) · path traversal (regex plus an independent containment check) · dev endpoints (constructor throw, env gate, token-or-loopback, constant-time, ignores proxy headers) · socket handshake (rate limited *before* verification, plus a DB lifecycle check because sockets bypass `JwtGuard`) · conversation rooms (verify participation) · error handling (generic 5xx, stacks server-side, 12 redacted field names) · secrets (only `.example` tracked; no service-role key in the frontend) · admin auth (per-IP *and* per-account limits, 5-attempt OTP lockout, CSRF double-submit, HttpOnly, revocation) · headers (`frame-ancestors 'none'`, `base-uri`, `form-action`, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`).

**Endpoint inventory:** 313 — 194 user-JWT, 87 admin, 1 optional, 31 public (all legitimately).

---

## What was not tested

**No live attack testing.** Manipulated JWTs against a running server, cross-user IDOR probing with real accounts, socket events from a real client, guessed media URLs, CSP enforcement in a browser — none performed; browser and session access were blocked in this session.

Everything above is static analysis plus tests at the security boundary. Where a fix closed an attack, I demonstrated the pre-fix code accepting the attack input and the post-fix code rejecting it. That is a real boundary test. It is not an authenticated end-to-end probe.

**The largest remaining gap: ownership checks across the 194 authenticated endpoints were reviewed by reading, not by probing.** A staging IDOR sweep is the highest-value next step.

**One flaky suite:** `src/share/share.routes.spec.ts` intermittently times out under full-suite parallel load (~65s). Passes alone, references neither `JwtGuard` nor cookies, renders images. Pre-existing, unrelated to this work — but worth a timeout bump so it stops masking real failures.

---

## Deployment notes

1. `SESSION_SECRET` should be set explicitly. It falls back to the service-role key, so no environment silently stores provider tokens unprotected — but rotating it invalidates every session, signing everyone out.
2. A migration is pending: `00000000000008_user_sessions`.
3. `R2_VERIFICATION_BUCKET_NAME` now also carries conversation media. If it is unset, those objects fall back to the main (public) bucket and layer 4 of finding 4 is inactive.
4. The bearer-token path in `JwtGuard` is deliberately still accepted, so clients holding pre-cookie tokens are not signed out on deploy. Remove it once traffic has moved over.
