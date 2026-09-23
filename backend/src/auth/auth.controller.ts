import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  UseGuards,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  ForbiddenException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { Request } from 'express';
import { timingSafeEqual } from 'crypto';
import { UAParser } from 'ua-parser-js';
import { AuthService } from './auth.service';
import { EmailService } from '../email/email.service';
import { JwtGuard } from '../common/guards/jwt.guard';
import { AllowSuspended } from '../common/decorators/allow-suspended.decorator';
import { AllowPendingDeletion } from '../common/decorators/allow-pending-deletion.decorator';
import { AllowBearerToken } from '../common/decorators/allow-bearer-token.decorator';
import { AuthRateLimitGuard } from '../common/guards/auth-ratelimit.guard';
import {
  LoginRateLimitGuard,
  loginAccountKey,
} from '../common/guards/login-ratelimit.guard';
import { RateLimitService } from '../common/rate-limit/rate-limit.service';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { clientIp } from '../common/rate-limit/client-ip.util';
import { RateLimitPolicyGuard } from '../common/rate-limit/rate-limit-policy.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserSessionService } from './session/user-session.service';
import {
  issueUserSessionCookies,
  clearUserSessionCookies,
  USER_CSRF_COOKIE,
  USER_REFRESH_COOKIE,
  USER_SESSION_ID_COOKIE,
} from './session/user-session-cookies';
import { config } from '../config';
import { UserSessionRevokedReason } from '@prisma/client';
import type { AuthenticatedUser } from '../common/types/authenticated-request';
import {
  CheckUsernameDto,
  CheckEmailDto,
  AccountExistsDto,
  LoginDto,
  TriggerWelcomeEmailDto,
  TriggerLoginEmailDto,
  TriggerPasswordChangedEmailDto,
  CreateCollegeRequestDto,
  VerifyPasswordDto,
  RequestPasswordResetDto,
  SignUpDto,
  ResendSignupOtpDto,
  ChangePasswordDto,
  AdoptSessionDto,
} from './dto/auth.dto';

@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly emailService: EmailService,
    private readonly rateLimit: RateLimitService,
    private readonly sessions: UserSessionService,
  ) {}

  /**
   * The session this request is coming from.
   *
   * Reads the id cookie rather than deriving it from the refresh token: the
   * refresh cookie's path is `/api/auth/session`, which by RFC 6265 path
   * matching does not cover `/api/auth/sessions`, so on the device-list and
   * revoke routes it is simply not sent. Deriving it there always answered
   * "none", which made every session look like somebody else's.
   */
  private currentSessionId(req: Request): string | null {
    const id = req.cookies?.[USER_SESSION_ID_COOKIE];
    return typeof id === 'string' && id ? id : null;
  }

  /**
   * Whether this request came from the installed app rather than a website.
   *
   * Keyed on `Origin`, which a browser sets itself and a page cannot forge.
   * That matters more than it might look: this flag decides whether session
   * tokens are written into the response BODY, where script can read them, and
   * a spoofable signal — a `X-Client: mobile` header, a user-agent sniff —
   * would let an XSS on the web app ask for the very tokens the HttpOnly
   * cookies exist to keep out of its reach, including the long-lived refresh
   * token that outlives the page.
   *
   * The origin is the one part of the request the page does not control, so it
   * is the only safe thing to key on.
   */
  private isNativeAppClient(req: Request): boolean {
    const origin = req.headers?.origin;
    if (typeof origin !== 'string' || !origin) return false;
    return config.app.cors.nativeAppOrigins.includes(origin);
  }

  /**
   * The token block the installed app needs, or nothing at all.
   *
   * Spread into a response so that a web caller's payload is byte-identical to
   * what it is today — the native fields are absent, not null, so nothing on
   * the web can start depending on them by accident.
   *
   * The app stores these in Keychain/Keystore and sends the access token as a
   * bearer, beside `x-session-id`. The session id is what keeps the pair
   * revocable; see USER_SESSION_ID_HEADER.
   */
  private nativeSessionTokens(
    req: Request,
    accessToken: string,
    refreshToken: string,
    expiresInSeconds: number,
  ) {
    if (!this.isNativeAppClient(req)) return {};
    return {
      accessToken,
      refreshToken,
      expiresIn: expiresInSeconds,
    };
  }

  /** IP and user agent, for the device row and for rotation. */
  private deviceOf(req: Request) {
    return {
      ip: clientIp(req) || null,
      userAgent: (req.headers['user-agent'] as string) || null,
    };
  }

  /**
   * How long the access cookie should live, from the token it carries.
   *
   * A cookie that outlives its token is the only shape that actually hurts:
   * the browser keeps sending a credential the server will refuse, and every
   * request pays a refresh round-trip to find that out. Reading `exp` off the
   * token keeps the two in step. The token has already been verified by
   * JwtGuard by the time this runs, so decoding it here reads a value we have
   * already checked the signature of.
   */
  private accessCookieMaxAge(token: string): number {
    try {
      const [, payload] = token.split('.');
      const claims = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf8'),
      );
      const remaining = Number(claims?.exp) * 1000 - Date.now();
      if (Number.isFinite(remaining) && remaining > 0) return remaining;
    } catch {
      // Unreadable payload on an already-verified token should not be
      // possible; fall through to the configured default rather than issue a
      // session-length cookie.
    }
    return config.auth.cookie.accessMaxAgeMs;
  }

  /**
   * The client's own profile, and the route that tells it which screen to show.
   *
   * Reachable in BOTH restricted states, and that is load-bearing rather than a
   * convenience. `accountStatus` travels in this payload, and it is the only
   * thing the suspension and deletion gates key off — so refusing this route
   * for a restricted account means the client never learns it is restricted.
   * The observed failure: a user signed in during their 30-day deletion window,
   * sync came back 403, `currentUser` stayed null, and the recovery screen
   * never mounted. They were left signed in to an app with no profile and no
   * explanation, unable to reach the Recover button at all. Suspended accounts
   * had the same fault for the same reason.
   *
   * Widening the gate by exactly this one route is safe: it returns the
   * caller's own profile and nothing else, which is precisely what the screen
   * that refuses them needs in order to render.
   */
  @Post('sync')
  @UseGuards(JwtGuard)
  @AllowSuspended()
  @AllowPendingDeletion()
  async syncProfile(@CurrentUser() user: AuthenticatedUser) {
    const syncedUser = await this.authService.syncProfile(user);
    return {
      message: 'Profile synchronized successfully',
      user: syncedUser,
      meta: syncedUser.meta || {},
    };
  }

  /**
   * "Am I signed in?", answered by the cookie and nothing else.
   *
   * The boot probe, and deliberately a GET. `sync` does the same work but is a
   * POST, so JwtGuard requires the double-submit CSRF header on it — and the
   * client can only produce that header if it can read `mf_csrf` with
   * `document.cookie`, which it cannot when the API is on a different host from
   * the app and the cookie is host-only. Restoring a session must not depend on
   * a cookie attribute: a safe method carries no CSRF requirement, so this
   * answers from the session cookies alone, in every deployment shape.
   *
   * `csrfToken` rides the body for the same reason the login response carries
   * it — the page may be unable to read the cookie, and echoing the token in a
   * header is what makes every later mutation possible. Handing it back here is
   * no weaker than the cookie: a cross-site page can read neither, and the
   * cookie stays the server's comparison anchor.
   *
   * Reachable in the restricted states for exactly the reason `sync` is: the
   * gates that explain them mount off this payload.
   */
  @Get('session')
  @UseGuards(JwtGuard)
  @AllowSuspended()
  @AllowPendingDeletion()
  async currentSession(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const syncedUser = await this.authService.syncProfile(user);
    const csrf = req.cookies?.[USER_CSRF_COOKIE];
    return {
      user: syncedUser,
      meta: syncedUser.meta || {},
      sessionId: this.currentSessionId(req),
      csrfToken: typeof csrf === 'string' ? csrf : null,
    };
  }

  /**
   * Takes custody of a session the browser minted against Supabase directly.
   *
   * Signup is the one flow that still does: `verifyOtp` is what confirms the
   * emailed code, and it answers with a session. Without this call that session
   * stayed in the tab — so a brand new account had no cookie session, no row in
   * the device list, nothing to revoke, and was signed out by its first reload
   * — and its refresh token stayed reachable from JavaScript, which is the
   * exposure HttpOnly cookies exist to remove.
   *
   * The access token is verified by JwtGuard from the Authorization header like
   * any other. The refresh token is in the body because handing it over is the
   * point: the server seals it into the session row, and the client drops its
   * copy immediately afterwards.
   */
  @Post('session/adopt')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtGuard, RateLimitPolicyGuard)
  @RateLimit('auth.session.adopt')
  // The bearer token IS the credential here — that is the whole call. There are
  // no cookies yet, and creating them is what this route does.
  @AllowBearerToken()
  async adoptSession(
    @Body() body: AdoptSessionDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: any,
  ) {
    // Profile first: the session row is a foreign key to it, and this is the
    // first request a brand-new account makes, so the row may not exist yet.
    // `syncProfile` creates it for a verified address. See `login`.
    const syncedUser = await this.authService.syncProfile(user);

    const issued = await this.sessions.issue(
      user.id,
      this.deviceOf(req),
      body.refreshToken,
    );

    const { csrfToken } = issueUserSessionCookies(
      res,
      user.token,
      issued.refreshToken,
      this.accessCookieMaxAge(user.token),
      issued.expiresAt.getTime() - Date.now(),
      issued.sessionId,
    );

    return {
      user: syncedUser,
      meta: syncedUser.meta || {},
      csrfToken,
      sessionId: issued.sessionId,
      ...this.nativeSessionTokens(
        req,
        user.token,
        issued.refreshToken,
        Math.max(1, Math.round(this.accessCookieMaxAge(user.token) / 1000)),
      ),
    };
  }

  /**
   * Server-side login proxy. Resolves username→email internally (never returned),
   * authenticates via Supabase, and returns only the session tokens. Brute-force
   * throttled per client IP by LoginRateLimitGuard. The "new login" notification
   * email is fired asynchronously and never blocks the response.
   */
  @Post('login')
  @UseGuards(LoginRateLimitGuard)
  async login(
    @Body() body: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: any,
  ) {
    let result: Awaited<ReturnType<typeof this.authService.login>>;
    try {
      result = await this.authService.login(body.identifier, body.password);
    } catch (error) {
      // Only failures spend the per-account budget. LoginRateLimitGuard has
      // already checked it on the way in; this is where the point is actually
      // charged, so a user cannot exhaust their own budget by signing in
      // successfully. Never awaited in a way that could change the error the
      // caller sees.
      const account = loginAccountKey(req);
      if (account) {
        await this.rateLimit.penalize('auth.login.account', account);
      }
      throw error;
    }

    /**
     * The profile comes BEFORE the session, because the session row points at
     * it: `UserSession.userId` is a foreign key to `User`.
     *
     * The order used to be the other way round, with this read treated as
     * optional enrichment afterwards. That held only while every account that
     * could pass the password check already had a `User` row. One that did not
     * — a verified signup whose handover never completed — passed Supabase,
     * then failed the session insert on the foreign key, and every sign-in it
     * ever attempted was a 500. `syncProfile` is the method that creates the
     * row for a verified account, so running it first is what lets such an
     * account recover by simply signing in.
     *
     * Its refusals propagate. They are a banned or permanently deleted account
     * (suspended and pending-deletion accounts are deliberately let through by
     * it), and neither should be handed a session. Anything else that fails it
     * is a database failure the session insert would have hit as well.
     */
    const profile = await this.authService.syncProfile({
      id: result.user.id,
      email: result.user.email,
    } as any);

    /**
     * Record the device and set HttpOnly cookies.
     *
     * The row created here is what makes the session revocable — it is the
     * thing "sign out this device" acts on — and the cookies are the only
     * credential the browser receives.
     *
     * NOTHING from `result.session` is returned any more, and that is the
     * point of this route rather than a detail of it.
     *
     * The response used to carry both Supabase tokens so the page could install
     * them into its own auth client. That left the provider's REFRESH token —
     * the long-lived half, the one that can mint access tokens for a month —
     * sitting in JavaScript, which is precisely the exposure HttpOnly cookies
     * were introduced to remove. It also put the same rotating token in two
     * hands at once: Supabase retires a refresh token the moment it is used, so
     * whichever of the browser and this server refreshed first silently killed
     * the other's copy, and a later use of the retired one trips Supabase's
     * reuse detection and revokes the whole family. That is a logout the user
     * did nothing to cause, and it is why a session could evaporate moments
     * after signing in.
     *
     * The server is now the only holder. `csrfToken` is here because the page
     * has to echo it on every mutation and cannot always read the cookie (a
     * host-only cookie on a different API hostname is invisible to
     * `document.cookie`); it is not a credential on its own.
     */
    const issued = await this.sessions.issue(
      result.user.id,
      this.deviceOf(req),
      result.session.refresh_token,
    );
    const { csrfToken } = issueUserSessionCookies(
      res,
      result.session.access_token,
      issued.refreshToken,
      (result.session.expires_in ?? 3600) * 1000,
      issued.expiresAt.getTime() - Date.now(),
      issued.sessionId,
    );

    // Only now has a sign-in actually happened. Sent earlier, it announced
    // sign-ins that went on to fail. Fire-and-forget — never blocks the
    // response.
    this.sendLoginNotification(
      result.user.email,
      result.user.displayName || result.user.email,
      req,
    ).catch(() => {});

    /**
     * The full profile travels with the login response.
     *
     * It used to carry only id/email/displayName, so the client had to make a
     * SECOND request to find out who it had just signed in as — and it treated
     * a failure of that request as a failed login, which it is not.
     *
     * One response now answers both questions. It is the same payload
     * `GET /api/auth/session` returns, from the same method, so a client that
     * signs in and a client that restores a session are looking at the same
     * shape.
     */
    return {
      user: profile,
      meta: profile?.meta ?? {},
      csrfToken,
      sessionId: issued.sessionId,
      ...this.nativeSessionTokens(
        req,
        result.session.access_token,
        issued.refreshToken,
        result.session.expires_in ?? 3600,
      ),
    };
  }

  /**
   * Rotates the refresh token.
   *
   * On the web this reads the cookie and never the body: the whole point there
   * is that the credential is not reachable by script. A rotation that fails
   * clears the cookies, so a client holding something stale ends up signed out
   * rather than retrying against a session that will never come back.
   *
   * The installed app has no cookie to read — a browser refuses to store the
   * `SameSite=Strict` session cookies in its WebView, which is the whole reason
   * the native client holds tokens itself — so for that client, and only that
   * client, the token arrives in the body.
   *
   * The body is accepted ONLY when there is no refresh cookie AND the request
   * came from the native origin, which a page cannot forge. Ordering matters:
   * checking the cookie first means a web caller can never opt into the body
   * path, so the rule "on the web the refresh token is not reachable by script"
   * is preserved exactly as it was.
   */
  @Post('session/refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitPolicyGuard)
  @RateLimit('auth.session.refresh')
  async refreshSession(
    @Req() req: Request,
    @Res({ passthrough: true }) res: any,
  ) {
    const cookieToken = req.cookies?.[USER_REFRESH_COOKIE];
    const bodyToken =
      !cookieToken && this.isNativeAppClient(req)
        ? (req.body as { refreshToken?: unknown })?.refreshToken
        : undefined;

    const token = cookieToken || bodyToken;
    if (!token || typeof token !== 'string') {
      clearUserSessionCookies(res);
      throw new UnauthorizedException('Session expired');
    }

    const rotated = await this.sessions.rotate(token, this.deviceOf(req));
    if (!rotated.ok) {
      clearUserSessionCookies(res);
      throw new UnauthorizedException('Session expired');
    }

    const providerToken = rotated.session.providerRefreshToken;
    if (!providerToken) {
      clearUserSessionCookies(res);
      throw new UnauthorizedException('Session expired');
    }

    const refreshed =
      await this.authService.refreshProviderSession(providerToken);
    if (!refreshed) {
      clearUserSessionCookies(res);
      throw new UnauthorizedException('Session expired');
    }

    // Supabase retires the presented token and issues a new one, so the row has
    // to hold the new value or the next rotation presents a dead token.
    await this.sessions.storeProviderRefresh(
      rotated.session.sessionId,
      refreshed.refresh_token,
    );

    const { csrfToken } = issueUserSessionCookies(
      res,
      refreshed.access_token,
      rotated.session.refreshToken,
      (refreshed.expires_in ?? 3600) * 1000,
      rotated.session.expiresAt.getTime() - Date.now(),
      rotated.session.sessionId,
    );

    return {
      csrfToken,
      sessionId: rotated.session.sessionId,
      ...this.nativeSessionTokens(
        req,
        refreshed.access_token,
        rotated.session.refreshToken,
        refreshed.expires_in ?? 3600,
      ),
    };
  }

  /**
   * Ends this device's session server-side, then clears its cookies.
   *
   * Deliberately NOT behind JwtGuard. Signing out has to work from the state
   * the user is actually in, and the state people sign out from most often is
   * one where something has already gone wrong: an access cookie past its
   * fifteen minutes, a token the provider no longer recognises. Behind the
   * guard every one of those answered 401 — so the row stayed live, the
   * cookies stayed in the browser, and the next reload signed the person
   * straight back into the account they had just left. On a shared machine
   * that is not a bug in a button, it is the next person inheriting a session.
   *
   * Authority comes from the refresh cookie instead, which is a credential:
   * holding it is what proves the caller owns the session being ended, and it
   * reaches this path because the cookie's own path (`/api/auth/session`) is a
   * prefix of it. No user id is needed, and none is trusted from the request.
   *
   * The double-submit check stays, so a page on another site cannot sign
   * somebody out for a laugh. If the CSRF cookie is already gone there is
   * nothing left to protect and the cookies are simply cleared.
   */
  @Post('session/logout')
  @HttpCode(HttpStatus.OK)
  async logoutSession(
    @Req() req: Request,
    @Res({ passthrough: true }) res: any,
  ) {
    const csrfCookie = req.cookies?.[USER_CSRF_COOKIE];
    if (typeof csrfCookie === 'string' && csrfCookie) {
      const header = req.headers['x-csrf-token'];
      if (
        typeof header !== 'string' ||
        header.length !== csrfCookie.length ||
        !timingSafeEqual(Buffer.from(header), Buffer.from(csrfCookie))
      ) {
        throw new ForbiddenException('CSRF validation failed');
      }
    }

    const refreshToken = req.cookies?.[USER_REFRESH_COOKIE];
    if (typeof refreshToken === 'string' && refreshToken) {
      await this.sessions.revokeByRefreshHash(
        this.sessions.hashRefreshToken(refreshToken),
        UserSessionRevokedReason.USER_LOGOUT,
      );
    }

    // Always, even when there was nothing to revoke. A browser left holding
    // cookies it cannot use is the state this route exists to end.
    clearUserSessionCookies(res);
    return { success: true };
  }

  /** The device list for the settings screen. */
  @Get('sessions')
  @UseGuards(JwtGuard)
  async listSessions(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.sessions.listForUser(
      user.id,
      this.currentSessionId(req) ?? undefined,
    );
  }

  /**
   * Signs out one other device.
   *
   * Scoped to the caller's own sessions in the service, so naming someone
   * else's session id revokes nothing.
   */
  @Delete('sessions/:id')
  @UseGuards(JwtGuard)
  async revokeSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const revoked = await this.sessions.revokeOwnedByUser(
      user.id,
      id,
      UserSessionRevokedReason.USER_REVOKED_DEVICE,
    );
    if (!revoked) throw new NotFoundException('Session not found');
    return { success: true };
  }

  /**
   * Signs out other devices, or every device including this one.
   *
   * The two password-change paths want different things, and the difference is
   * not cosmetic. Changing a password from Settings is done by someone sitting
   * at a device they trust: they are ending everyone else's access, not their
   * own, and logging them out of the screen they are standing on would be a
   * bug. A reset through the emailed link is the opposite — it is the flow
   * someone uses when they believe their account is compromised, and the device
   * completing it may itself be the one they are worried about. There,
   * everything goes, this session included.
   *
   * `scope` defaults to 'others' so a caller that forgets it cannot
   * accidentally sign the user out of the tab they are using.
   */
  @Post('sessions/revoke-all')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtGuard)
  @AllowSuspended()
  @AllowPendingDeletion()
  async revokeAllSessions(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: any,
    @Body() body?: { scope?: 'others' | 'all' },
  ) {
    const scope = body?.scope === 'all' ? 'all' : 'others';

    const currentId = scope === 'others' ? this.currentSessionId(req) : null;

    const count = await this.sessions.revokeAllForUser(
      user.id,
      scope === 'all'
        ? UserSessionRevokedReason.PASSWORD_CHANGED
        : UserSessionRevokedReason.USER_LOGOUT_ALL,
      currentId ?? undefined,
    );

    // Nothing this browser holds is valid any more, so the cookies go with it.
    // Leaving them set would have the client keep presenting a credential the
    // server has already revoked, and reading the 401 as a bug rather than as
    // the sign-out it asked for.
    if (scope === 'all') clearUserSessionCookies(res);

    return { success: true, revoked: count, scope };
  }

  /** Builds device/UA/IP context and queues the new-login email. Never awaited by callers. */
  private async sendLoginNotification(
    email: string,
    name: string,
    req: Request,
  ) {
    const rawUA = (req.headers['user-agent'] as string) || '';
    const parser = new UAParser(rawUA);
    const ua = parser.getResult();

    const browserName = ua.browser?.name || 'Unknown Browser';
    const browserVersion = ua.browser?.major || '';
    const browser = browserVersion
      ? `${browserName} ${browserVersion}`
      : browserName;

    const osName = ua.os?.name || 'Unknown OS';
    const osVersion = ua.os?.version || '';
    const os = osVersion ? `${osName} ${osVersion}` : osName;

    const deviceType = ua.device?.type;
    const deviceModel = ua.device?.model;
    const deviceVendor = ua.device?.vendor;
    let device: string;
    if (deviceModel && deviceVendor) device = `${deviceVendor} ${deviceModel}`;
    else if (deviceType === 'mobile') device = 'Mobile Device';
    else if (deviceType === 'tablet') device = 'Tablet';
    else device = 'Desktop / Laptop';

    // `req.ip` rather than the raw header: this address is shown to the user in
    // a security email, and the leftmost X-Forwarded-For entry is whatever the
    // caller wrote — so an attacker could make the "new login from…" notice
    // display any address they liked.
    const ip = clientIp(req) || 'Unknown';

    const loginTime = new Date().toLocaleString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });

    await this.emailService.sendNewLoginEmail(
      email,
      name,
      device,
      'Unknown Location',
      loginTime,
      browser,
      os,
      ip,
    );
  }

  /**
   * Signup, proxied so it can be metered.
   *
   * `supabase.auth.signUp` used to be called from the browser, so it passed
   * through nothing of ours and the only ceiling on it was Supabase's — which
   * is per-project and therefore shared by every user at once. See
   * `auth.signup.ip` / `auth.signup.account`.
   *
   * Returns no session, because signup does not produce one: the account is
   * created unconfirmed and the browser gets its session later by verifying the
   * emailed code.
   */
  @Post('signup')
  @UseGuards(RateLimitPolicyGuard)
  @RateLimit('auth.signup.ip', 'auth.signup.account')
  async signUp(@Body() body: SignUpDto) {
    return this.authService.signUpWithEmail(body);
  }

  /** Re-send the signup confirmation code. Same budgets as signup itself. */
  @Post('signup/resend')
  @UseGuards(RateLimitPolicyGuard)
  @RateLimit('auth.signup.ip', 'auth.signup.account')
  async resendSignupOtp(@Body() body: ResendSignupOtpDto) {
    return this.authService.resendSignupOtp(body.email);
  }

  /**
   * Request a password-reset link.
   *
   * Replaces the pair the forgot-password screen used to make — an
   * `account-exists` probe followed by `resetPasswordForEmail` fired straight
   * at Supabase from the browser. Only the first half was ever rate-limited,
   * which left the half that actually sends mail unmetered.
   */
  @Post('request-password-reset')
  @UseGuards(AuthRateLimitGuard, RateLimitPolicyGuard)
  @RateLimit('auth.passwordreset.account')
  async requestPasswordReset(@Body() body: RequestPasswordResetDto) {
    return this.authService.requestPasswordReset(body.email);
  }

  /**
   * Confirm the caller knows their current password.
   *
   * Behind JwtGuard because it verifies the password of the account making the
   * request and nobody else's — there is no address in the body, so this cannot
   * be pointed at another user.
   *
   * `RateLimitPolicyGuard` is listed after `JwtGuard` deliberately: the policy
   * is user-keyed, and it reads the identity the auth guard attaches.
   */
  @Post('verify-password')
  @UseGuards(JwtGuard, RateLimitPolicyGuard)
  @RateLimit('auth.verifypassword.user')
  async verifyPassword(
    @Body() body: VerifyPasswordDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.authService.verifyPassword(user, body.password);
  }

  /**
   * Change password, and sign every OTHER device out.
   *
   * The revocation is part of the operation rather than a follow-up call the
   * client might skip or fail to make: a password change is the moment any
   * session someone else is holding has to stop working. This device is spared
   * — the person changing their password asked for that, not to be logged out
   * of the screen they are standing on.
   */
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtGuard, RateLimitPolicyGuard)
  @RateLimit('auth.verifypassword.user')
  async changePassword(
    @Body() body: ChangePasswordDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    await this.authService.changePassword(
      user,
      body.currentPassword,
      body.newPassword,
    );

    const revoked = await this.sessions.revokeAllForUser(
      user.id,
      UserSessionRevokedReason.PASSWORD_CHANGED,
      this.currentSessionId(req) ?? undefined,
    );

    return { success: true, otherSessionsRevoked: revoked };
  }

  @Post('check-username')
  @UseGuards(AuthRateLimitGuard)
  async checkUsername(@Body() body: CheckUsernameDto) {
    return this.authService.checkUsernameAvailability(body.username);
  }

  @Post('check-email')
  @UseGuards(AuthRateLimitGuard)
  async checkEmail(@Body() body: CheckEmailDto) {
    return this.authService.checkEmailAvailability(body.email, body.collegeId);
  }

  /**
   * Backs the forgot-password screen's "No account found" message.
   *
   * Separate from `check-email`, which answers the signup question ("may I
   * register this?") and folds college-domain gating into its reply. A password
   * reset does not care which college an address belongs to, only whether there
   * is an account behind it, and conflating the two would have the reset screen
   * telling people to use their official college email.
   *
   * Rate-limited like the other unauthenticated lookups, which is what stops it
   * being usable to enumerate addresses in bulk.
   */
  @Post('account-exists')
  @UseGuards(AuthRateLimitGuard)
  async accountExists(@Body() body: AccountExistsDto) {
    return this.authService.accountExistsForEmail(body.email);
  }

  @Post('events/welcome')
  @UseGuards(JwtGuard, RateLimitPolicyGuard)
  @RateLimit('auth.emailtrigger.user')
  async triggerWelcomeEmail(
    @Body() body: TriggerWelcomeEmailDto,
    @CurrentUser() user: { id: string; email: string },
  ) {
    const recipientEmail = this.resolveRecipientEmail(user, body.email);
    await this.emailService.sendWelcomeEmail(recipientEmail, body.name);
    return { success: true };
  }

  @Post('events/login')
  @UseGuards(JwtGuard, RateLimitPolicyGuard)
  @RateLimit('auth.emailtrigger.user')
  async triggerLoginEmail(
    @Body() body: TriggerLoginEmailDto,
    @Req() req: Request,
    @CurrentUser() user: { id: string; email: string },
  ) {
    const recipientEmail = this.resolveRecipientEmail(user, body.email);

    // Parse User-Agent from the request header for accurate device/browser/OS info
    const rawUA = body.userAgent || req.headers['user-agent'] || '';
    const parser = new UAParser(rawUA);
    const uaResult = parser.getResult();

    const browserName = uaResult.browser?.name || 'Unknown Browser';
    const browserVersion = uaResult.browser?.major || '';
    const browser =
      body.browser ||
      (browserVersion ? `${browserName} ${browserVersion}` : browserName);

    const osName = uaResult.os?.name || 'Unknown OS';
    const osVersion = uaResult.os?.version || '';
    const os = body.os || (osVersion ? `${osName} ${osVersion}` : osName);

    const deviceType = uaResult.device?.type;
    const deviceModel = uaResult.device?.model;
    const deviceVendor = uaResult.device?.vendor;
    let device = body.device;
    if (!device) {
      if (deviceModel && deviceVendor) {
        device = `${deviceVendor} ${deviceModel}`;
      } else if (deviceType === 'mobile') {
        device = 'Mobile Device';
      } else if (deviceType === 'tablet') {
        device = 'Tablet';
      } else {
        device = 'Desktop / Laptop';
      }
    }

    // Resolved from req.ip (see trust proxy in main.ts), not from the raw
    // header, whose leftmost entry is supplied by the caller.
    const ip =
      body.ip || clientIp(req) || req.socket?.remoteAddress || 'Unknown';

    // Format login time in the user's local timezone sent from the browser
    let loginTime: string;
    if (body.time) {
      loginTime = body.time;
    } else {
      const timezone = body.timezone || 'UTC';
      const now = new Date();
      try {
        loginTime = now.toLocaleString('en-US', {
          timeZone: timezone,
          weekday: 'short',
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        });
      } catch {
        // Fallback if timezone string is invalid
        loginTime = now.toLocaleString('en-US', {
          weekday: 'short',
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        });
      }
    }

    await this.emailService.sendNewLoginEmail(
      recipientEmail,
      body.name,
      device,
      body.location || 'Unknown Location',
      loginTime,
      browser,
      os,
      ip,
    );
    return { success: true };
  }

  @Post('events/password-changed')
  @UseGuards(JwtGuard, RateLimitPolicyGuard)
  @RateLimit('auth.emailtrigger.user')
  async triggerPasswordChangedEmail(
    @Body() body: TriggerPasswordChangedEmailDto,
    @Req() req: Request,
    @CurrentUser() user: { id: string; email: string },
  ) {
    const recipientEmail = this.resolveRecipientEmail(user, body.email);

    // Parse device info from User-Agent
    const rawUA = body.device || req.headers['user-agent'] || '';
    const parser = new UAParser(rawUA);
    const uaResult = parser.getResult();

    const browserName = uaResult.browser?.name || 'Unknown Browser';
    const browserVersion = uaResult.browser?.major || '';
    const browser = browserVersion
      ? `${browserName} ${browserVersion}`
      : browserName;

    const deviceType = uaResult.device?.type;
    const deviceModel = uaResult.device?.model;
    const deviceVendor = uaResult.device?.vendor;
    let device: string;
    if (deviceModel && deviceVendor) {
      device = `${deviceVendor} ${deviceModel}`;
    } else if (deviceType === 'mobile') {
      device = `Mobile — ${browser}`;
    } else if (deviceType === 'tablet') {
      device = `Tablet — ${browser}`;
    } else {
      device = `Desktop — ${browser}`;
    }

    // Derive client IP
    // `req.ip` rather than the raw header: this address is shown to the user in
    // a security email, and the leftmost X-Forwarded-For entry is whatever the
    // caller wrote — so an attacker could make the "new login from…" notice
    // display any address they liked.
    const ip = clientIp(req) || 'Unknown';

    // Format timestamp if not provided by the client
    const time =
      body.time ||
      new Date().toLocaleString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      });

    await this.emailService.sendPasswordChangedEmail(
      recipientEmail,
      body.name || 'User',
      time,
      device,
      ip,
    );
    return { success: true };
  }

  /**
   * Resolves and verifies that transactional emails are strictly dispatched
   * to the authenticated caller's verified address, preventing arbitrary email spoofing.
   */
  private resolveRecipientEmail(
    user: { id: string; email: string },
    suppliedEmail?: string,
  ): string {
    const userEmail = user?.email?.toLowerCase()?.trim();
    const isFallback = !userEmail || userEmail.endsWith('@meetifyy.user');

    if (suppliedEmail) {
      const cleanSupplied = suppliedEmail.toLowerCase().trim();
      if (!isFallback && cleanSupplied !== userEmail) {
        throw new ForbiddenException(
          'Cannot trigger email notification for an arbitrary recipient',
        );
      }
      return cleanSupplied;
    }

    if (isFallback) {
      throw new ForbiddenException('No verified recipient email address found');
    }

    return userEmail;
  }

  @Post('request-college')
  @UseGuards(RateLimitPolicyGuard)
  @RateLimit('auth.collegerequest.ip', 'auth.collegerequest.email')
  async requestCollege(@Body() body: CreateCollegeRequestDto) {
    const request = await this.authService.createCollegeRequest(body);
    return {
      success: true,
      message: 'Campus request submitted successfully',
      request,
    };
  }
}
