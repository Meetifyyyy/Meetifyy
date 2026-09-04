import { IS_PRODUCTION, APP_ENV, int, oneOf, str } from './env';

/**
 * Rate-limit policy — the single source of truth for every limit in the app.
 *
 * Values live here as literals, deliberately NOT as environment variables. A
 * limit that can be weakened by an env var is a limit that gets weakened during
 * an incident, and it makes "the same limits in every environment" impossible
 * to enforce. The environment supplies infrastructure only: which Redis, which
 * key prefix, which hashing secret, how many proxies sit in front of us.
 *
 * Changing a number here is a reviewed commit. Bump POLICY_VERSION when you do,
 * so a shift in the 429 metrics can be attributed to a specific revision.
 */

/** Bumped whenever any policy value below changes. Emitted on every decision. */
export const POLICY_VERSION = 5;

export type RateLimitAlgorithm = 'fixed-window' | 'token-bucket';

/** Which dimension a policy counts against. */
export type RateLimitDimension =
  | 'user' // authenticated user id — unforgeable, from a verified JWT
  | 'ip' // client address, after trust-proxy resolution and IPv6 /64 collapse
  | 'account' // a submitted email address, normalised and hashed
  | 'resource'; // a server-resolved id (conversation, target user, …)

export interface RateLimitPolicy {
  /** Requests allowed inside `duration`. */
  readonly points: number;
  /** Window length, seconds. */
  readonly duration: number;
  /** Extra penalty after the budget is spent, seconds. Omit for none. */
  readonly blockDuration?: number;
  /** Which identifier this policy counts. */
  readonly dimension: RateLimitDimension;
  /**
   * What happens when Redis cannot answer.
   *
   *  'closed' — fall back to a per-instance in-memory limiter and keep
   *             enforcing. Used where an unmetered endpoint during an outage is
   *             exactly what an attacker is waiting for.
   *  'open'   — allow the request. Used for reads, where degrading the product
   *             to guard against a hypothetical is the wrong trade.
   *
   * Either way the fallback is counted and logged; nothing fails silently.
   */
  readonly onRedisFailure: 'open' | 'closed';
  /**
   * Suppress RateLimit-Remaining / RateLimit-Policy headers and return a coarse
   * Retry-After. Set on anything that could confirm an account exists or tell a
   * prober how close to the wall they are.
   */
  readonly sensitive?: boolean;
  /** Human-readable message returned on rejection. */
  readonly message: string;
}

/**
 * Global tiers.
 *
 * `global.user` and `global.ip` are mutually exclusive by design: once a
 * request carries a verified JWT the user tier governs and the IP tier is
 * skipped entirely. Applying both would key thousands of students behind one
 * campus NAT gateway — or one carrier CGNAT — into a single bucket and take the
 * whole campus down during registration week.
 */
export const RATE_LIMIT_POLICIES = {
  /**
   * 300/min per authenticated user.
   *
   * Raised from the previous 100/min as part of fixing the identifier: that 100
   * never actually applied per user (see RateLimitService), so this is the
   * first time a real per-user ceiling exists. An engaged session opening the
   * feed, notifications and a conversation with focus-refetch peaks around
   * 40-60 rpm; 300 leaves roughly 5x headroom, which also covers the apiClient
   * failover path where traffic against the surviving backend briefly doubles.
   */
  'global.user': {
    points: 300,
    duration: 60,
    dimension: 'user',
    onRedisFailure: 'open',
    message: 'You are making requests too quickly. Please slow down.',
  },

  /**
   * 120/min per IP, unauthenticated traffic only. Anonymous callers reach only
   * the public help centre, the academics catalog and media reads; 120 covers a
   * first page load with assets, and anything sustained above it is a scraper.
   */
  'global.ip': {
    points: 120,
    duration: 60,
    dimension: 'ip',
    onRedisFailure: 'open',
    message: 'You are making requests too quickly. Please slow down.',
  },

  /**
   * Short-window companion to global.ip, so a ten-second flood is caught
   * without waiting out a full minute-long window.
   */
  'global.ip.burst': {
    points: 25,
    duration: 10,
    dimension: 'ip',
    onRedisFailure: 'open',
    message: 'You are making requests too quickly. Please slow down.',
  },

  /**
   * Login brute-force / credential-stuffing budget, per client IP.
   *
   * Value unchanged from the previous LoginRateLimitGuard — what changed is
   * that the IP it keys on can no longer be chosen by the caller.
   */
  'auth.login.ip': {
    points: 10,
    duration: 300,
    blockDuration: 300,
    dimension: 'ip',
    onRedisFailure: 'closed',
    sensitive: true,
    message:
      'Too many login attempts. Please wait a few minutes and try again.',
  },

  /**
   * Account-existence probes: username/email availability and the reset-email
   * lookup. Value unchanged; identifier fixed.
   */
  'auth.probe.ip': {
    points: 20,
    duration: 60,
    dimension: 'ip',
    onRedisFailure: 'closed',
    sensitive: true,
    message: 'Too many attempts. Please try again shortly.',
  },

  /**
   * The second login dimension: per targeted account.
   *
   * The IP budget above stops one host hammering many accounts (password
   * spraying). It does nothing about the opposite shape — a botnet spread over
   * thousands of addresses, each making a couple of attempts against ONE
   * account — because no single IP ever reaches its limit. OWASP's guidance is
   * to limit by IP, by account, or ideally both; this is the other half.
   *
   * Only FAILED attempts spend a point (see AuthController.login), so a user
   * on a flaky connection can never be locked out of their own account by
   * their own successful logins.
   */
  'auth.login.account': {
    points: 6,
    duration: 900,
    blockDuration: 900,
    dimension: 'account',
    onRedisFailure: 'closed',
    sensitive: true,
    message:
      'Too many login attempts. Please wait a few minutes and try again.',
  },

  /**
   * The daily companion to auth.probe.ip, and the control that actually closes
   * account enumeration.
   *
   * 20/minute is the right shape for a signup form checking availability as
   * someone types, but sustained it is ~28,800 probes a day — an attacker with
   * patience walks the entire user table inside the per-minute limit without
   * ever tripping it. A day-scale ceiling is what makes that not work.
   */
  'auth.probe.daily': {
    points: 200,
    duration: 86_400,
    dimension: 'ip',
    onRedisFailure: 'closed',
    sensitive: true,
    message: 'Too many attempts. Please try again later.',
  },

  /**
   * Account-deletion and recovery OTPs, per account.
   *
   * Keyed on the authenticated user rather than a submitted address, because
   * both routes sit behind JwtGuard and carry no email in the body — the code
   * always goes to the address already on the account.
   *
   * These send email. Without a limit the endpoint is an email bomb pointed at
   * any address, and it drains a budget that is shared platform-wide: because
   * auth is proxied through this backend, Supabase's 30-OTP-per-hour project
   * ceiling applies to everyone at once, so one abuser can stop every other
   * user receiving a code.
   */
  'auth.otp.user': {
    points: 5,
    duration: 900,
    dimension: 'user',
    onRedisFailure: 'closed',
    sensitive: true,
    message:
      "You've requested several codes recently. Please wait a few minutes before requesting another.",
  },

  /**
   * Minimum spacing between OTP requests for one account.
   *
   * Mirrors Supabase's own 60-second per-user floor, so an impatient user gets
   * our clear message with a countdown instead of an opaque upstream 429.
   */
  'auth.otp.cooldown': {
    points: 1,
    duration: 60,
    dimension: 'user',
    onRedisFailure: 'closed',
    sensitive: true,
    message: 'Please wait a moment before requesting another code.',
  },

  /** OTP requests per address, to catch account rotation from one host. */
  'auth.otp.ip': {
    points: 20,
    duration: 86_400,
    dimension: 'ip',
    onRedisFailure: 'closed',
    sensitive: true,
    message: 'Too many code requests. Please try again later.',
  },

  /**
   * The authenticated endpoints that trigger transactional email (welcome,
   * new-login notice, password-changed notice). Each fires once per real
   * lifecycle event, so 3/hour is generous and still caps the amplifier.
   */
  'auth.emailtrigger.user': {
    points: 6,
    duration: 3600,
    dimension: 'user',
    onRedisFailure: 'closed',
    message: 'Too many requests. Please try again shortly.',
  },

  /**
   * Unauthenticated write into the admin college-request queue. Nothing but the
   * global tier stood in front of this, so filling the admin console with
   * garbage cost an attacker almost nothing.
   */
  'auth.collegerequest.ip': {
    points: 5,
    duration: 86_400,
    dimension: 'ip',
    onRedisFailure: 'closed',
    message:
      "You've already submitted a campus request recently. We'll be in touch.",
  },
  'auth.collegerequest.email': {
    points: 3,
    duration: 86_400,
    dimension: 'account',
    onRedisFailure: 'closed',
    message:
      "You've already submitted a campus request recently. We'll be in touch.",
  },

  /**
   * Admin sign-in. Stricter than user login and blocked for longer: these
   * credentials are the highest-value target in the system, the console is
   * public-facing, and there is no legitimate reason for an admin to make many
   * failed attempts in a row.
   */
  'admin.login.ip': {
    points: 8,
    duration: 300,
    blockDuration: 1800,
    dimension: 'ip',
    onRedisFailure: 'closed',
    sensitive: true,
    message: 'Too many attempts. Please try again later.',
  },
  'admin.login.account': {
    points: 5,
    duration: 900,
    blockDuration: 1800,
    dimension: 'account',
    onRedisFailure: 'closed',
    sensitive: true,
    message: 'Too many attempts. Please try again later.',
  },

  // ── Messaging ──────────────────────────────────────────────────────────────
  //
  // Keyed on the OPERATION, never on the path. `/api/messages/:id/messages`,
  // `/api/dm/:id/messages` and `/api/group-chats/:id/messages` are three routes
  // onto one action, and the socket `message:send` event is a fourth. A limit
  // attached to a URL is bypassed by rotating between them; a limit keyed on
  // the sender and the conversation is the same budget from all four.

  /**
   * 60/min is a message a second, sustained — comfortably past what a person
   * types and still far below what a script needs to be useful. Raised from an
   * initial 45 to leave room for the fastest real users before any production
   * data existed to argue otherwise.
   *
   * ASSUMPTION: not yet validated against production traffic. Watch the 429
   * rate on this policy; rejections spread across many distinct users mean it
   * is too tight, rejections concentrated on a few mean it is working.
   */
  'msg.send.user': {
    points: 60,
    duration: 60,
    dimension: 'user',
    onRedisFailure: 'closed',
    message: "You're sending messages very quickly. Give it a moment.",
  },

  /**
   * The dimension a per-user limit cannot provide: flooding ONE conversation.
   *
   * A per-user budget of 60/min lets an abuser put all 60 into a single
   * person's chat. This caps what any one conversation can receive from one
   * sender, which is the shape harassment actually takes.
   *
   * The most likely of all these numbers to need tuning: a lively group chat
   * with several people talking at once is the realistic false-positive case,
   * which is why it sits at 40 rather than the 25 first proposed.
   *
   * Enforced in the service layer, after the participant check, so a rejection
   * can never confirm that a conversation exists.
   */
  'msg.send.conversation': {
    points: 40,
    duration: 60,
    dimension: 'resource',
    onRedisFailure: 'closed',
    message: "You're sending messages very quickly. Give it a moment.",
  },

  /** Forwarding is the cheapest spam fan-out primitive in the product. */
  'msg.forward.user': {
    points: 30,
    duration: 60,
    dimension: 'user',
    onRedisFailure: 'closed',
    message: "You're forwarding messages very quickly. Give it a moment.",
  },

  /**
   * Opening conversations with people you have no thread with is the
   * unsolicited-contact vector. Existing conversations are unaffected.
   */
  'msg.startconv.user': {
    points: 25,
    duration: 3600,
    dimension: 'user',
    onRedisFailure: 'closed',
    message:
      "You've started a lot of new conversations recently. Try again later.",
  },

  /** Group creation fans out invitations and notifications to many people. */
  'msg.creategroup.user': {
    points: 8,
    duration: 3600,
    dimension: 'user',
    onRedisFailure: 'closed',
    message: "You've created several groups recently. Try again later.",
  },

  // ── Realtime ───────────────────────────────────────────────────────────────

  /**
   * New socket connections per address.
   *
   * The reconnect-storm control. A deploy or a network blip disconnects every
   * client at once and they all come back together, each firing the expensive
   * rejoin queries below. 20/min per address absorbs a normal reconnect while
   * bounding a client stuck in a tight loop.
   */
  'socket.connect.ip': {
    points: 40,
    duration: 60,
    dimension: 'ip',
    onRedisFailure: 'closed',
    message: 'Reconnecting too frequently. Please wait a moment.',
  },

  /**
   * New socket connections per USER — the precise half of the pair above.
   *
   * `socket.connect.ip` has to stay loose because a campus NAT gateway puts
   * thousands of students behind one address, so it can only ever be a coarse
   * anti-flood backstop. This tier has no such problem: it is keyed on the
   * verified account, so it can be tight without any risk of one person's
   * reconnect loop affecting anybody else.
   *
   * 10/min is already generous for a real client. Socket.IO reconnects with
   * backoff from 1s to a 10s ceiling, so even a client fighting a flaky network
   * settles well under this; anything sustained above it is a broken or hostile
   * client, and refusing it protects the user's own battery as much as our
   * server.
   *
   * Applied AFTER the token is verified — see handleConnection for why the IP
   * tier must stay in front of that.
   */
  'socket.connect.user': {
    points: 10,
    duration: 60,
    dimension: 'user',
    onRedisFailure: 'closed',
    message: 'Reconnecting too frequently. Please wait a moment.',
  },

  /**
   * `message:catchup` and `conversation:join_rooms` — the two database-heavy
   * events that fire on every reconnect, and so the main storm amplifier.
   */
  'socket.catchup.user': {
    points: 10,
    duration: 60,
    dimension: 'user',
    onRedisFailure: 'closed',
    message: 'Syncing too frequently. Please wait a moment.',
  },

  /** Room joins each carry an authorization check. */
  'socket.roomjoin.user': {
    points: 60,
    duration: 60,
    dimension: 'user',
    onRedisFailure: 'closed',
    message: 'Too many room changes. Please wait a moment.',
  },

  // ── Instant Match ──────────────────────────────────────────────────────────
  //
  // Values carried over unchanged from InstantMatchRateLimiter; what changes is
  // that they are now shared across replicas instead of counted in one
  // process's memory, where the effective limit was silently multiplied by the
  // replica count and reset on every deploy.

  'im.join.user': {
    points: 10,
    duration: 60,
    dimension: 'user',
    onRedisFailure: 'closed',
    message: 'Slow down a moment before searching again.',
  },

  /**
   * The hourly quota the per-minute limit cannot provide: 10/min sustained is
   * 600 queue joins an hour, which is account-farming volume, not use.
   */
  'im.join.hourly.user': {
    points: 40,
    duration: 3600,
    dimension: 'user',
    onRedisFailure: 'closed',
    message: "You've searched for a lot of matches recently. Try again later.",
  },

  /** Account-rotation defence: a farm of throwaway accounts behind one host. */
  'im.join.ip': {
    points: 25,
    duration: 3600,
    dimension: 'ip',
    onRedisFailure: 'closed',
    message: 'Too many match requests from this network. Try again later.',
  },

  'im.respond.user': {
    points: 30,
    duration: 60,
    dimension: 'user',
    onRedisFailure: 'closed',
    message: 'Slow down a moment.',
  },

  /** Was entirely unlimited — a state read a stuck client can spin on. */
  'im.queuesync.user': {
    points: 20,
    duration: 60,
    dimension: 'user',
    onRedisFailure: 'closed',
    message: 'Slow down a moment.',
  },

  /** Unauthenticated support intake, per IP. Value unchanged. */
  'support.request.ip': {
    points: 5,
    duration: 3600,
    dimension: 'ip',
    onRedisFailure: 'closed',
    message:
      "You've sent several support requests recently. Please wait a little while before sending another.",
  },

  /**
   * Support intake, per submitted address. The confirmation email goes to
   * whatever address the form carries, so without this the endpoint is a mail
   * amplifier pointed at an inbox the sender does not control. Value unchanged.
   */
  'support.request.email': {
    points: 3,
    duration: 3600,
    dimension: 'account',
    onRedisFailure: 'closed',
    message:
      "You've sent several support requests recently. Please wait a little while before sending another.",
  },
} as const satisfies Record<string, RateLimitPolicy>;

export type RateLimitPolicyName = keyof typeof RATE_LIMIT_POLICIES;

/**
 * How many reverse proxies sit between the internet and Express.
 *
 * MUST match the real deployment. Too low and every client resolves to the
 * proxy address, collapsing every IP-keyed limit into one shared bucket. Too
 * high and the caller's own X-Forwarded-For entry is treated as the client
 * address — the spoofing hole this whole change exists to close.
 *
 * MEETIFYY'S TOPOLOGY, and why the production default is 1
 * -------------------------------------------------------
 * `api.meetifyy.app` is a Cloudflare CNAME set to DNS-only (grey cloud), so
 * Cloudflare resolves the name but is NOT in the request path and adds no hop.
 * Azure Container Apps ingress is the only proxy: browser -> Azure -> Node.
 * That is one hop.
 *
 * There is a SECOND path. `vercel.json` rewrites `/_api/*` to the same backend,
 * which apiClient falls back to when the direct host is unreachable. That path
 * is browser -> Vercel -> Azure -> Node, i.e. two hops. One setting has to
 * serve both, and the two disagree. Measured against real Express:
 *
 *   hops=1  direct honest -> client        hops=2  direct honest -> client
 *           direct SPOOFED -> client (safe)        direct SPOOFED -> ATTACKER
 *           via Vercel    -> Vercel's IP           via Vercel    -> client
 *
 * 1 is therefore the correct choice: it is spoof-proof on the path essentially
 * all traffic uses, and 2 reopens the vulnerability there. The cost is that
 * traffic arriving through the Vercel failover proxy all resolves to Vercel's
 * egress address and shares one bucket. That is a stable, unspoofable wrong
 * value rather than a caller-controlled one, it only applies while the direct
 * API is unreachable, and authenticated users are unaffected because they are
 * counted per user. If the failover path ever becomes normal traffic rather
 * than an emergency, this needs revisiting — most likely by having the Vercel
 * rewrite forward a signed header the backend can trust.
 *
 * 0 locally, where Express talks to the client directly. Confirm any deployed
 * value by checking that a forged X-Forwarded-For does not move `req.ip`.
 */
const trustProxyHops = int('TRUST_PROXY_HOPS', {
  default: IS_PRODUCTION ? '1' : '0',
  min: 0,
  max: 10,
});

/**
 * Enforce everywhere, in every environment — that is the whole point.
 *
 * 'shadow' evaluates every policy and records the decision without rejecting
 * anything. It exists for the rollout described in the audit (measure real
 * percentiles before enforcing) and for debugging, and it is refused outright
 * in production so it cannot become an accidental bypass.
 */
const configuredMode = oneOf(
  'RATE_LIMIT_MODE',
  ['enforce', 'shadow'] as const,
  {
    default: 'enforce',
  },
);

export const rateLimitConfigValues = {
  policies: RATE_LIMIT_POLICIES,
  policyVersion: POLICY_VERSION,

  mode: IS_PRODUCTION ? ('enforce' as const) : configuredMode,

  trustProxyHops,

  /**
   * Key namespace, so environments sharing one Redis cannot consume each
   * other's budgets. Mirrors the REDIS_QUEUE_PREFIX convention that already
   * protects the BullMQ queues.
   */
  keyPrefix: str('RATE_LIMIT_KEY_PREFIX', { default: `rl:${APP_ENV}` }),

  /**
   * Secret for hashing personal identifiers (IP addresses, email addresses)
   * before they become Redis keys or log fields. Falls back to the Supabase JWT
   * secret so an unconfigured environment still hashes rather than storing
   * addresses in the clear.
   */
  hashSecret:
    str('RATE_LIMIT_HASH_SECRET') ||
    str('SUPABASE_JWT_SECRET') ||
    'meetifyy-rl',
};

export type RateLimitConfig = typeof rateLimitConfigValues;
