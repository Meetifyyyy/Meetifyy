# Why the site fails to load on some college networks

Live URL: **https://dev.meetifyy.app**

Symptom: `ERR_CONNECTION_RESET` — "This site can't be reached. The connection
was reset." The page never loads at all, on some networks only.

## Two different failures, only one of which code can fix

A connection reset happens *before* any of our code runs: the browser could not
complete a TCP/TLS connection, so nothing was served and nothing executed. Which
host was reset decides who can fix it.

| What is blocked | What the user sees | Fixable in code? |
|---|---|---|
| `dev.meetifyy.app` (the app) | browser error page, nothing loads | **No** — DNS/hosting only |
| `meetifyy-production.up.railway.app` (the API) | app shell loads, everything fails | **Yes** — done, see "Same-origin API failover" |

The reported symptom is the first row. Fix §1 below.

## Measured state

Taken from an unfiltered network — every host is up, so nothing is down.

| Host | DNS | Serving | Proxied by Cloudflare? |
|---|---|---|---|
| `dev.meetifyy.app` | CNAME → `a91ff774d3898bd9.vercel-dns-017.com` → `216.198.79.1`, `64.29.17.1` (A only, no AAAA) | Vercel, `bom1` edge, HTTP/2, TLS 1.2 + 1.3 all 200 | **No** — no `cf-ray` header |
| `meetifyy.app` | `104.21.93.27`, `172.67.203.125` + AAAA | Cloudflare | Yes — but returns **error 1000** |
| `meetifyy-production.up.railway.app` | `69.46.46.14` | Railway, `/health` 200 | No |

The zone's nameservers are `sue.ns.cloudflare.com` / `doug.ns.cloudflare.com`, so
**`meetifyy.app` is already a Cloudflare zone** and `dev` is a record inside it
that is currently set to *DNS only* (grey cloud).

## §1 — Put `dev.meetifyy.app` behind the Cloudflare proxy

This is the fix for the reported symptom, and it is a toggle in a dashboard you
already own.

Right now the campus filter sees two Vercel /24s (`216.198.79.0/24`,
`64.29.17.0/24`). Those are recent Vercel ranges; institutional filters commonly
default-deny ranges their categorisation feeds do not recognise, and a single
abusive tenant on shared hosting is enough to get a range categorised badly.
Cloudflare's ranges are effectively un-blockable by comparison — denying them
breaks too much of the web for a campus to tolerate.

1. Cloudflare → `meetifyy.app` → DNS → the `dev` record → set it to **Proxied**
   (orange cloud).
2. Cloudflare → SSL/TLS → set the mode to **Full (strict)**. Vercel presents a
   valid public certificate, so strict is correct; anything less is a
   downgrade for no benefit.
3. Keep `dev.meetifyy.app` listed as a domain in the Vercel project — Vercel
   must keep terminating TLS for its own certificate to stay renewed.
4. Verify: `curl -sI https://dev.meetifyy.app/ | grep -i cf-ray` should now
   return a header. Today it returns nothing.

## §2 — Fix the apex

`https://meetifyy.app/` returns Cloudflare **error 1000, "DNS points to
prohibited IP"**: the apex record points at a Cloudflare IP, which is a proxy
loop. Anyone typing the bare domain gets an error page.

Replace the apex A records with a Cloudflare **Redirect Rule** sending
`meetifyy.app/*` → `https://dev.meetifyy.app/$1` (or to the production hostname
once there is one). A redirect rule needs no origin, so the loop cannot recur.

## §3 — Move the API off the shared PaaS wildcard

`*.up.railway.app` is shared by every Railway project, which makes it a standing
blocklist target. Give the API a first-party hostname — `api.meetifyy.app`,
proxied through the same Cloudflare zone — and point `VITE_API_URL` at it.
Nothing in the client needs to change: `getBackendUrl()` reads that variable and
`getMediaUrl()` derives media URLs from it.

Do this even after the failover below exists. Failover is a safety net; it is
not as good as an origin that is simply never blocked.

## Same-origin API failover (fixed in code)

For the second row of the table — API blocked, app reachable — the client now
recovers on its own.

- `vercel.json` rewrites `/_api/:path*` to the Railway backend, so the same API
  is reachable from the app's own origin. It is declared **before** the SPA
  catch-all rewrite, which would otherwise swallow it into `index.html`.
- `apiClient` starts on the direct origin as before. If a request fails with a
  `TypeError` — the unambiguous "could not connect": DNS failure, reset, blocked
  host, and never an HTTP error status — it probes `/_api/health`. Only if that
  probe succeeds does it switch the session to the proxy origin and retry. A
  network that blocks everything therefore does not pay two failed round-trips
  per request.
- The switch is remembered in `sessionStorage` and announced as an
  `api:origin-changed` event. The socket store rebuilds its connection against
  the new origin — its singleton guard now keys on origin as well as token, so a
  live socket pointed at an unreachable host is replaced rather than retried
  forever.
- Realtime through the proxy stays on long-polling: a Vercel rewrite is an HTTP
  proxy and will not carry a WebSocket upgrade. Degraded, but live.

Healthy networks never touch any of this — the failover only arms after a real
connection failure.

## Realtime transport (fixed in code)

The Socket.IO client was WebSocket-first. On a clean network that saves a
round-trip; behind an intercepting proxy it does the opposite, because the proxy
accepts the TCP connection and then resets or silently drops the upgrade, so
every connect burned the full handshake timeout before falling back and every
reconnect repeated it. It now starts on long-polling with `upgrade: true` and an
8s timeout.

## Ruled out

- **IPv6.** `dev.meetifyy.app` is A-only. A broken-IPv6 network cannot be the cause.
- **TLS version or HTTP version.** TLS 1.2, TLS 1.3, HTTP/2 and HTTP/1.1 all
  return 200.
- **Port 80.** Redirects 308 to HTTPS correctly.
- **CORS.** A CORS failure produces a loaded page with failing requests and a
  console error — never `ERR_CONNECTION_RESET`, never a blank browser error page.
- **Redirect loops.** The only redirect is `meetify-web.vercel.app` →
  `dev.meetifyy.app`, which terminates.
- **Backend health.** `/health` returns 200.

## Confirming it from the affected network

Run this on the campus network before changing anything. It separates DNS
blocking, TCP/SNI blocking and TLS interception, which need different fixes.

```bash
for h in dev.meetifyy.app meetifyy-production.up.railway.app; do echo "== $h"; getent hosts "$h" || echo "  DNS FAILED"; curl -sS -o /dev/null -w "  http=%{http_code} tls_verify=%{ssl_verify_result} t=%{time_total}\n" --max-time 15 "https://$h/" || echo "  CONNECT FAILED"; done
```

- **DNS FAILED**, but `dig @1.1.1.1 dev.meetifyy.app` succeeds → resolver-level
  blocking. §1 fixes it (different IPs) only if the filter blocks by IP; if it
  blocks by hostname, the domain itself is categorised and you need the filter's
  operator.
- **CONNECT FAILED / reset** on `dev.meetifyy.app` → IP-range or SNI blocking.
  §1 is the fix.
- **CONNECT FAILED / reset** on the Railway host only → the failover above
  already handles it; §3 removes the cause.
- **`tls_verify` non-zero** → the network intercepts TLS with its own CA. Our
  HSTS header (`max-age=63072000; includeSubDomains; preload`) makes that a hard
  failure with no click-through. That is correct behaviour and should not be
  weakened; the user needs the campus CA installed, or another network.
