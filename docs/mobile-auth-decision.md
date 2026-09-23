# Mobile auth: the options, at diff level

**Status:** decision needed. Nothing here is implemented.
**Written:** 2026-09-21, after the first on-device run.

---

## The problem, measured

On a vivo I2208 (Android 14, WebView Chrome 153), running the debug APK:

1. `POST /api/auth/login` **succeeds** — `201`, full user object in the body.
2. The server sets all four cookies, each `Secure; SameSite=Strict`, `Domain=.meetifyy.app`.
3. Chrome **blocks all four**:
   ```
   BLOCKED  mf_access, mf_refresh, mf_sid, mf_csrf
   reasons: ["SchemefulSameSiteStrict"]
   ```
4. Cookie jar afterwards: **empty**.
5. Every authenticated request 401s. `/api/auth/session/refresh` 401s. The app
   falls back to `/`.

**Why.** The WebView page origin is `https://localhost`. The API is a different
site, so the request is `sec-fetch-site: cross-site` (measured, not inferred). A
browser will not store a `SameSite=Strict` cookie from a cross-site response.

`Domain=.meetifyy.app` is **not** a factor. It domain-matches the API host, which
is what the rule is about; it is legal here.

**There is no fallback today.** `POST /api/auth/login` returns
`{ user, meta, csrfToken, sessionId }`. The access token exists **only** inside
the HttpOnly cookie, so a native client has no credential it can hold.

---

## The constraint that rules out the obvious fix

The naive version of "use bearer tokens on mobile" is to put `@AllowBearerToken`
on the authenticated routes. **That re-opens a vulnerability that was
deliberately closed**, and the code says so in as many words
(`src/common/decorators/allow-bearer-token.decorator.ts`):

> Adding this decorator to any other route re-opens the bypass for that route.

The bypass: a Supabase access token is a self-contained JWT, valid for its full
hour on signature alone, naming no session. The session table is what makes
"sign out this device", "sign out everywhere" and password-change revocation
real, and it can only be consulted for a request that **names a session**. A
bearer caller named none, so the revocation check was skipped entirely — moving
a token from the cookie jar into an `Authorization` header defeated every one of
those controls for up to an hour.

Today that check lives in `jwt.guard.ts` and is gated on `usedCookie`, reading
`mf_sid` from the cookies.

**So the real question is not "cookie or bearer". It is: can a mobile credential
name a session?** It can, and that is what makes Option A sound.

---

## Option A — session-bound mobile tokens (recommended)

Mobile holds a token **and** a session id, so the guard runs the *same*
revocation check it runs for cookies. Bearer becomes as revocable as cookie
rather than an exemption from revocation.

### Backend

**`src/common/guards/jwt.guard.ts`** — the only security-relevant change.

Today (~line 477):

```ts
if (usedCookie) {
  const sessionId = request.cookies?.[USER_SESSION_ID_COOKIE];
  if (typeof sessionId !== 'string' || !sessionId) throw new UnauthorizedException(...);
  const session = await this.resolveSession(sessionId);
  if (!session || !session.active || session.userId !== userPayload.id) throw ...;
}
```

Proposed: take the session id from the cookie **or** an `X-Session-Id` header,
and require it on both paths.

```ts
const sessionId =
  request.cookies?.[USER_SESSION_ID_COOKIE] ?? request.headers['x-session-id'];
const legacyBearer = !usedCookie && bearerAllowed;   // the signup handover only

if (!legacyBearer) {
  if (typeof sessionId !== 'string' || !sessionId) throw new UnauthorizedException(...);
  const session = await this.resolveSession(sessionId);
  if (!session || !session.active || session.userId !== userPayload.id) throw ...;
}
```

Note what this does **not** change: the ownership check
(`session.userId !== userPayload.id`) and the presence check both stay exactly
as they are, and both now apply to mobile too. The existing
`@AllowBearerToken` routes keep their current exemption and no new route gets
the decorator.

Also in the guard, ~line 400: the `if (!usedCookieToken) { ...refuse... }` block
needs to accept a bearer that carries a valid session id. CSRF stays scoped to
`usedCookie` and is **correct as-is** — a bearer caller is not CSRF-able.

**`src/auth/auth.controller.ts`** — return the tokens in the body for mobile
callers only, keyed off an explicit client header rather than a User-Agent
sniff:

```ts
return {
  user: ..., meta: ..., csrfToken, sessionId,
  ...(isMobileClient(req) && {
    accessToken: result.session.access_token,
    refreshToken: issued.refreshToken,
    expiresIn: result.session.expires_in ?? 3600,
  }),
};
```

Same for `session/refresh` (~line 407), which already calls `sessions.rotate()`
and therefore already does the right thing server-side.

**No Prisma change.** `UserSession` already has everything: `issue`, `rotate`,
`isActive`, `revoke`, `revokeFamily`, `revokeAllForUser`,
`sessionIdForRefreshToken` all exist in `user-session.service.ts`. So CLAUDE.md's
migration rules do not come into play.

**CORS:** production must still allowlist `https://localhost` — see the separate
finding below. That is required for *any* option.

> **Update 2026-09-23:** no longer a release step. `https://localhost` is a
> built-in default (`DEFAULT_NATIVE_APP_ORIGINS` in `app.config.ts`), applied
> whenever `NATIVE_APP_ORIGINS` is unset — which it is in every environment.
> `prod-boot.spec.ts` pins that production's exact variable set allows it.

### Frontend

| File | Change |
|---|---|
| `src/platform/contracts.ts` | `SecureStorage` already defined. No change. |
| `src/platform/capacitor/secureStorage.js` | **New.** The contract has no implementation yet. Needs a Keychain/Keystore plugin — a new dependency, and the one genuinely new third-party choice in this option. |
| `src/core/api/transport.js` | Attach `X-Session-Id` beside the existing `Authorization` header. The bearer path already exists (line ~356) for the signup handover. |
| `src/platform/web/sessionSource.js` | Unchanged — web keeps cookies. |
| `src/mobile/main.jsx` | Inject the secure-storage-backed session source. |

### Blast radius on web

**None, by construction.** Web sends no `X-Session-Id` header and keeps using
cookies, so it takes the identical code path it takes today. The guard change is
additive: it widens where a session id may be *read from*, and tightens the
bearer path from "skip the check" to "run the check". No route gains a
decorator. 146 controllers / ~321 route handlers are behind `JwtGuard`, and none
of their behaviour changes for a cookie caller.

The one thing to watch is the `legacyBearer` carve-out: it must stay pinned to
the two signup-handover routes, or it silently becomes the old bypass again.
That deserves a test asserting the decorator appears on exactly those two
handlers and no others.

---

## Option B — `COOKIE_SAME_SITE=none`

One environment variable. No client work. Login starts working immediately.

**What it costs.**

- It is **global**. `sameSite` is read once in `src/config/auth.config.ts` and
  used by both `user-session-cookies.ts` and `admin-auth-cookies.ts`, so the web
  app and the admin app both drop from `Strict` to `None`. The guard's own
  comment calls `SameSite=Strict` "the first line" of CSRF defence; this removes
  it everywhere to fix one client. The `mf_csrf` double-submit remains, so it is
  not undefended — but it is strictly weaker than today.
- It depends on **third-party cookies**, which Chrome is actively phasing out
  and which Android WebView gates behind
  `CookieManager.setAcceptThirdPartyCookies`. A fix that a browser policy change
  can silently undo is not a foundation for a shipped app.
- It does not survive iOS. WKWebView's ITP is more aggressive still, which is
  what test D3 was originally for.

**When it is nonetheless the right call:** if the goal is a working internal
build this week and a store release is months away, this unblocks every
remaining device test (D3, D5, D6, D9 all need a logged-in session) at the cost
of one revert later. It is a legitimate *staging* choice, not a shipping one.

---

## Recommendation

**Option A**, with Option B available as a temporary unblock if device testing
needs to continue before A lands.

A matches the plan already approved (native secure storage was always on the
roadmap), changes nothing for web, and ends with bearer callers *more* checked
than they are today rather than less. Its real cost is a new secure-storage
dependency and a guard change that must be reviewed carefully — which is an
argument for doing it deliberately, not for avoiding it.

If A is chosen, it should be its own branch and its own PR, separate from the
Capacitor wrap, because it touches the authentication guard.

---

## Related finding: production CORS will reject the app

Independent of which option is chosen.

`allowLocalNetwork` in `backend/src/config/app.config.ts` is **forced off in
production**:

```ts
allowLocalNetwork: IS_PRODUCTION ? false : bool('CORS_ALLOW_LOCAL_NETWORK', { default: 'true' }),
```

`https://localhost` — the Capacitor origin — is therefore allowed on dev *only*
because that flag defaults on outside production. Measured against dev:

| Origin | Result |
|---|---|
| `https://localhost` (Capacitor, both platforms after the `iosScheme` fix) | allowed |
| `capacitor://localhost` (old iOS default) | rejected |
| `http://localhost:5173` (dev web) | allowed |
| `https://evil.example.com` | rejected — the allowlist is not a reflector |

**The shipped app would get no CORS at all**, and this surfaces for the first
time at release. Fix: add `https://localhost` to `CORS_ORIGINS` in the
production environment.

> **Update 2026-09-23 — superseded; do not add it by hand.** The origin is now
> allowed by default in code (`DEFAULT_NATIVE_APP_ORIGINS`), so production
> accepts the app as soon as a build containing that code is deployed, with no
> variable to set. Measured on 2026-09-23: the production API, still on a `main`
> build without that code, refuses `https://localhost`; the dev API, on the
> code, accepts it. The one way to break it is setting `NATIVE_APP_ORIGINS` to
> an **empty** value, which means "no app origins".

Worth stating plainly, because it sits against the comment that says a
production API must never treat a developer machine as same-trust: allowlisting
`https://localhost` in production does mean a page served from localhost on
anyone's machine can *make* credentialed requests. What protects the account is
that it still cannot *authenticate* — under Option A it has no token and no
session id, and under cookies it cannot read `mf_csrf` cross-origin. The origin
being allowed is not the origin being trusted. It is still worth a second pair
of eyes before it ships.
