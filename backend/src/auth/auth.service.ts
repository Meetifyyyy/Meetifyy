import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { resolveSignInEligibility } from './sign-in-eligibility';
import {
  isReservedUsername,
  RESERVED_USERNAME_MESSAGE,
} from '../common/users/reserved-usernames';
import { SupabaseService } from '../supabase/supabase.service';
import { DefaultAssetsService } from '../uploads/default-assets.service';
import { DomainValidatorService } from '../common/services/domain-validator.service';
import { RedisService } from '../redis/redis.service';
import { LruCache } from '../common/utils/lru-cache.util';
import { validateBirthday } from '../common/utils/birthday-validation.util';
import {
  checkEmailFormat,
  EmailFormat,
  normalizeEmail,
} from '../common/validation/email-format.util';
import type { AuthenticatedUser } from '../common/types/authenticated-request';
import { randomInt } from 'crypto';

/**
 * Bounded LRU cache for auth sync results.
 * Max 10,000 entries (≈ 10K concurrent active users). 60-second TTL per entry.
 * Automatically evicts the least-recently-used entry when the cap is reached,
 * preventing unbounded memory growth that the previous plain Map caused.
 */
const syncCache = new LruCache<string, { data: any; timestamp: number }>(
  10000,
  60000,
);

export function clearAuthSyncCache(userId?: string) {
  if (userId) {
    syncCache.delete(userId);
  } else {
    syncCache.clear();
  }
}

/**
 * One row of the profile bootstrap query below.
 *
 * `$queryRaw` is untyped by construction, so this restates the SELECT's column
 * list. It is the shape the whole sync path reads from — the aliases
 * (`college_id`, `settings_id`) and the JSON_AGG arrays included — and keeping
 * it next to the query is what makes a column rename show up as a type error
 * rather than as `undefined` at runtime.
 */
interface ProfileRow {
  id: string;
  username: string | null;
  displayName: string | null;
  email: string | null;
  bio: string | null;
  course: string | null;
  branch: string | null;
  passingYear: number | null;
  location: string | null;
  createdAt: Date;
  updatedAt: Date;
  avatar: string | null;
  avatarMediaId: string | null;
  collegeEmail: string | null;
  collegeId: string | null;
  cover: string | null;
  coverMediaId: string | null;
  verificationStatus: string | null;
  birthday: Date | null;
  interests: string[] | null;
  profileCompleted: boolean | null;
  accountStatus: string | null;
  deletedAt: Date | null;
  role: string | null;
  canPost: boolean | null;
  canMessage: boolean | null;
  canActivity: boolean | null;
  isCampusRep: boolean | null;
  college_id: string | null;
  college_name: string | null;
  settings_id: string | null;
  emailNotifs: boolean | null;
  pushNotifs: boolean | null;
  privateProfile: boolean | null;
  showOnlineStatus: boolean | null;
  showLastSeen: boolean | null;
  whoCanSeeOnline: string | null;
  whoCanSeeLastSeen: string | null;
  readReceipts: boolean | null;
  followingList: string[] | null;
  followersList: string[] | null;
  postBookmarkIds: string[] | null;
  activityBookmarkIds: string[] | null;
  unreadNotifCount: number | null;
}

/**
 * `user_metadata` is arbitrary JSON supplied by the identity provider, so a
 * value read from it is only usable once it has actually been checked to be a
 * non-empty string. Several of these flowed straight into the database — and
 * `birthday` into validateBirthday — without that check.
 */
function metaString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  // syncCache is the module-level bounded LruCache — not a per-instance field.
  private syncCache = syncCache;
  /** Coalesces concurrent syncProfile calls for the same user into one DB round-trip. */
  private syncInflight = new Map<string, Promise<any>>();

  clearSyncCache(userId?: string) {
    clearAuthSyncCache(userId);
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly supabaseService: SupabaseService,
    private readonly domainValidatorService: DomainValidatorService,
    private readonly defaultAssets: DefaultAssetsService,
    @Optional() private readonly redisService?: RedisService,
  ) {}

  async syncProfile(user: AuthenticatedUser) {
    if (!this.supabaseService.isConfigured) {
      throw new UnauthorizedException('Supabase is not configured');
    }

    const now = Date.now();
    // LruCache.get() already enforces the 60s TTL internally — returns undefined if stale.
    const cached = this.syncCache.get(user.id);
    if (cached) {
      return cached.data;
    }

    // If another request for this user is already in-flight, wait for it instead of querying DB again.
    const existing = this.syncInflight.get(user.id);
    if (existing) return existing;

    const promise = this._doSyncProfile(user).finally(() => {
      this.syncInflight.delete(user.id);
    });
    this.syncInflight.set(user.id, promise);
    return promise;
  }

  private async _doSyncProfile(user: AuthenticatedUser) {
    const rows = await this.prisma.$queryRaw<ProfileRow[]>`
      SELECT 
        u."id",
        u."username",
        u."displayName",
        u."email",
        u."bio",
        u."course",
        u."branch",
        u."passingYear",
        u."location",
        u."createdAt",
        u."updatedAt",
        u."avatar",
        u."avatarMediaId",
        u."collegeEmail",
        u."collegeId",
        u."cover",
        u."coverMediaId",
        u."verificationStatus",
        u."birthday",
        u."interests",
        u."profileCompleted",
        u."accountStatus",
        u."deletedAt",
        u."role",
        u."canPost",
        u."canMessage",
        u."canActivity",
        u."isCampusRep",
        c."id" AS "college_id",
        c."name" AS "college_name",
        s."id" AS "settings_id",
        s."emailNotifs",
        s."pushNotifs",
        s."privateProfile",
        s."showOnlineStatus",
        s."showLastSeen",
        s."whoCanSeeOnline",
        s."whoCanSeeLastSeen",
        s."readReceipts",
        COALESCE(
          (SELECT JSON_AGG(u_fol."username") 
           FROM "Follow" f 
           JOIN "User" u_fol ON f."followingId" = u_fol."id" 
           WHERE f."followerId" = u."id"),
          '[]'::json
        ) AS "followingList",
        COALESCE(
          (SELECT JSON_AGG(u_fol."username") 
           FROM "Follow" f 
           JOIN "User" u_fol ON f."followerId" = u_fol."id" 
           WHERE f."followingId" = u."id"),
          '[]'::json
        ) AS "followersList",
        COALESCE(
          (SELECT JSON_AGG(pb."postId") 
           FROM "PostBookmark" pb 
           WHERE pb."userId" = u."id"),
          '[]'::json
        ) AS "postBookmarkIds",
        COALESCE(
          (SELECT JSON_AGG(ab."activityId") 
           FROM "ActivityBookmark" ab 
           WHERE ab."userId" = u."id"),
          '[]'::json
        ) AS "activityBookmarkIds",
        (SELECT COUNT(*)::int 
         FROM "Notification" n 
         WHERE n."recipientId" = u."id" AND n."readAt" IS NULL AND n."deletedAt" IS NULL AND n."type" != 'MESSAGE'::"NotificationType"
           -- Mirrors NotificationsService.AVAILABLE_ACTOR. This count feeds the
           -- bell badge, and the list it is counting excludes notifications
           -- whose actor has deleted their account — so without the same clause
           -- the badge shows a number the list can never clear.
           AND (n."actorId" IS NULL OR EXISTS (
             SELECT 1 FROM "User" au WHERE au."id" = n."actorId" AND au."deletedAt" IS NULL
           ))) AS "unreadNotifCount"
      FROM "User" u
      LEFT JOIN "College" c ON u."collegeId" = c."id"
      LEFT JOIN "UserSettings" s ON s."userId" = u."id"
      WHERE u."id" = ${user.id}
      LIMIT 1;
    `;

    if (rows && rows.length > 0) {
      const row = rows[0];

      // A permanently deleted account is gone and stays gone. An account
      // inside its 30-day window is NOT: `deletedAt` is stamped the moment
      // deletion is requested (that is what hides it from everyone else), so
      // the plain `row.deletedAt` test used to lock the owner out of the only
      // screen that can undo it. Sign-in is deliberately allowed for
      // PENDING_DELETION; `JwtGuard` then refuses every route except the
      // recovery flow, so the session that comes back can do nothing else.
      const eligibility = resolveSignInEligibility(row);
      if (!eligibility.allowed) {
        if (eligibility.reason === 'BANNED') {
          // A ban is terminal and not appealable through the app.
          throw new ForbiddenException('Account has been banned');
        }
        throw new UnauthorizedException('Account has been deleted');
      }
      // A suspension deliberately does NOT block sign-in. The account needs a
      // working session to be told what happened and to request a review; every
      // route other than that flow is refused by JwtGuard, so letting the
      // session exist does not let a suspended user use the product.
      // `accountStatus` travels in the payload below, which is what the client
      // keys the suspension screen off.

      // Perform domain lookup for college auto-linking, but DO NOT block existing accounts
      // if their domain was later deactivated/removed from admin portal.
      const domainCheck = await this.domainValidatorService.validateDomain(
        row.email ?? '',
      );
      if (!domainCheck.isValid) {
        this.logger.log(
          `Existing user ${row.id} (${row.email}) logged in with unapproved/removed domain`,
        );
      }

      const settings = row.settings_id
        ? {
            id: row.settings_id,
            userId: row.id,
            emailNotifs: row.emailNotifs,
            pushNotifs: row.pushNotifs,
            privateProfile: row.privateProfile,
            showOnlineStatus: row.showOnlineStatus,
            showLastSeen: row.showLastSeen,
            whoCanSeeOnline: row.whoCanSeeOnline,
            whoCanSeeLastSeen: row.whoCanSeeLastSeen,
            readReceipts: row.readReceipts,
          }
        : null;

      let college = row.college_id
        ? { id: row.college_id, name: row.college_name }
        : null;

      // If user has no collegeId assigned or domain mapping changed, auto-link to active matching college
      if (
        domainCheck.isValid &&
        domainCheck.info?.collegeId &&
        row.college_id !== domainCheck.info.collegeId
      ) {
        row.college_id = domainCheck.info.collegeId;
        row.college_name = domainCheck.info.collegeName;
        college = {
          id: domainCheck.info.collegeId,
          name: domainCheck.info.collegeName,
        };
        this.prisma.user
          .update({
            where: { id: row.id },
            data: { collegeId: domainCheck.info.collegeId },
          })
          .catch((err) =>
            this.logger.error(
              `Failed to auto-link user collegeId: ${err.message}`,
            ),
          );
      }

      // Auto-heal legacy / fallback usernames or displayNames starting with user_
      const isRandomUsername =
        typeof row.username === 'string' && row.username.startsWith('user_');
      const isRandomDisplayName =
        typeof row.displayName === 'string' &&
        row.displayName.startsWith('user_');

      if (isRandomUsername || isRandomDisplayName) {
        try {
          let meta = user.user_metadata || {};
          const {
            data: { user: adminUser },
          } = await this.supabaseService.client.auth.admin
            .getUserById(user.id)
            .catch(() => ({ data: { user: null } }));
          if (adminUser?.user_metadata) {
            meta = { ...adminUser.user_metadata, ...meta };
          }

          let healUsername = row.username;
          let healDisplayName = row.displayName;

          if (isRandomUsername) {
            const candidate =
              metaString(meta.username) ||
              (row.email && !row.email.endsWith('@meetifyy.user')
                ? row.email.split('@')[0]
                : null) ||
              (row.collegeEmail ? row.collegeEmail.split('@')[0] : null) ||
              (user.email && !user.email.endsWith('@meetifyy.user')
                ? user.email.split('@')[0]
                : null);

            if (candidate) {
              let clean = candidate
                .trim()
                .toLowerCase()
                .replace(/[^a-z0-9_.]/g, '_');
              if (clean.length >= 3) {
                clean = clean.slice(0, 30);
                const existing = await this.prisma.user.findUnique({
                  where: { username: clean },
                });
                if (!existing || existing.id === row.id) {
                  healUsername = clean;
                }
              }
            }
          }

          if (isRandomDisplayName || healDisplayName === row.username) {
            const rawTargetName =
              metaString(meta.displayName) ||
              (metaString(meta.firstName)
                ? `${metaString(meta.firstName)} ${metaString(meta.lastName) ?? ''}`.trim()
                : null) ||
              (healUsername && !healUsername.startsWith('user_')
                ? healUsername
                : null) ||
              (row.email && !row.email.endsWith('@meetifyy.user')
                ? row.email.split('@')[0]
                : null);

            if (rawTargetName && !rawTargetName.startsWith('user_')) {
              healDisplayName = rawTargetName
                .replace(/[._]/g, ' ')
                .split(' ')
                .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
                .join(' ')
                .slice(0, 30);
            }
          }

          if (
            healUsername !== row.username ||
            healDisplayName !== row.displayName
          ) {
            await this.prisma.user.update({
              where: { id: row.id },
              data: {
                ...(healUsername !== null ? { username: healUsername } : {}),
                ...(healDisplayName !== null
                  ? { displayName: healDisplayName }
                  : {}),
              },
            });
            row.username = healUsername;
            row.displayName = healDisplayName;
            this.syncCache.delete(row.id);
            this.logger.log(
              `Auto-healed user handle for userId=${row.id}: username="${healUsername}", displayName="${healDisplayName}"`,
            );
          }
        } catch (healErr) {
          this.logger.warn(
            `Auto-heal failed for userId=${row.id}: ${healErr.message}`,
          );
        }
      }

      const result = {
        id: row.id,
        username: row.username,
        displayName: row.displayName,
        email: row.email,
        bio: row.bio,
        course: row.course,
        branch: row.branch,
        passingYear: row.passingYear,
        location: row.location,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        avatar: row.avatar,
        avatarMediaId: row.avatarMediaId,
        collegeEmail: row.collegeEmail,
        collegeId: row.college_id,
        cover: row.cover,
        coverMediaId: row.coverMediaId,
        verificationStatus: row.verificationStatus,
        birthday: row.birthday,
        interests: row.interests || [],
        profileCompleted: row.profileCompleted,
        accountStatus: row.accountStatus,
        role: row.role,
        canPost: row.canPost,
        canMessage: row.canMessage,
        canActivity: row.canActivity,
        isCampusRep: row.isCampusRep,
        college,
        settings,
        followingList: row.followingList || [],
        followersList: row.followersList || [],
        meta: {
          postBookmarkIds: row.postBookmarkIds || [],
          activityBookmarkIds: row.activityBookmarkIds || [],
          unreadNotifCount: Number(row.unreadNotifCount || 0),
        },
      };
      this.syncCache.set(user.id, { data: result, timestamp: Date.now() });
      return result;
    }

    // ─── SECURITY GATE ────────────────────────────────────────────────────────
    // Only create a new Prisma user record when the email has been verified via
    // OTP. This blocks the password-reset-creates-account exploit: a reset link
    // creates a Supabase session but the email is never marked confirmed through
    // the OTP flow, so this gate prevents the upsert from running.
    //
    // email_confirmed_at is set by Supabase when the user verifies their OTP.
    // confirmed_at is an alias kept for older Supabase versions.
    // ─────────────────────────────────────────────────────────────────────────
    let emailConfirmedAt = user.email_confirmed_at || user.confirmed_at;
    if (!emailConfirmedAt && this.supabaseService.isConfigured) {
      // When the API verifies JWTs locally (SUPABASE_JWT_SECRET set), the token
      // payload doesn't carry email_confirmed_at. Resolve it authoritatively via
      // the admin API before blocking. This only runs on the new-account path
      // (no Prisma row yet), so it's off the hot request route.
      try {
        const { data } =
          await this.supabaseService.client.auth.admin.getUserById(user.id);
        emailConfirmedAt =
          (data?.user as any)?.email_confirmed_at ||
          (data?.user as any)?.confirmed_at;
      } catch {
        // Admin lookup failed — fall through to the block below (fail safe).
      }
    }
    if (!emailConfirmedAt) {
      this.logger.warn(
        `Blocked account creation for unverified session userId=${user.id}`,
      );
      throw new UnauthorizedException(
        'Email verification required. Please complete the OTP verification step to create your account.',
      );
    }

    // Fetch full user metadata from Supabase Admin API if username or user_metadata is missing from payload
    let sbUser = user;
    if ((!sbUser.user_metadata?.username || !sbUser.email) && sbUser.id) {
      try {
        const {
          data: { user: adminUser },
          error,
        } = await this.supabaseService.client.auth.admin.getUserById(user.id);
        if (!error && adminUser) {
          sbUser = {
            ...sbUser,
            ...adminUser,
            user_metadata: {
              ...(sbUser.user_metadata || {}),
              ...(adminUser.user_metadata || {}),
            },
          };
        }
      } catch (err) {
        // Fallback admin lookup failed; proceed with whatever info we have from JwtGuard
      }
    }

    if (!sbUser || (!sbUser.user_metadata && !sbUser.email)) {
      throw new UnauthorizedException('Could not retrieve Supabase user info');
    }

    const rawUsername =
      metaString(sbUser.user_metadata?.username) ||
      sbUser.email?.split('@')[0] ||
      `user_${user.id.slice(0, 8)}`;
    let username = rawUsername
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_.]/g, '_');
    if (username.length < 3) {
      username = `user_${user.id.slice(0, 8)}`;
    }
    username = username.slice(0, 30);

    const metaFirstName = metaString(sbUser.user_metadata?.firstName);
    const displayName =
      metaString(sbUser.user_metadata?.displayName) ??
      (metaFirstName
        ? `${metaFirstName} ${metaString(sbUser.user_metadata?.lastName) ?? ''}`.trim()
        : username);

    const email = sbUser.email || '';
    const domainValidation =
      await this.domainValidatorService.validateDomain(email);
    if (!domainValidation.isValid) {
      this.logger.warn(
        `Account creation rejected for ${email}: ${domainValidation.reason}`,
      );
      throw new UnauthorizedException(domainValidation.reason);
    }
    const collegeId = domainValidation.info?.collegeId || null;

    // Run email and username conflict checks in parallel — they are independent queries
    const [existingUserByEmail, existingUserByUsername] = await Promise.all([
      this.prisma.user.findUnique({ where: { email } }),
      this.prisma.user.findUnique({ where: { username } }),
    ]);

    // Resolve email/ID conflicts (especially with mock/seed users).
    //
    // SAFETY: Never delete an existing account here. This code runs on the
    // ordinary login/sync path, and a legitimate user may simply have no posts
    // yet — the old "delete if 0 posts" heuristic could destroy a real account.
    // Instead we free up the (unique) email by moving the stale/duplicate record
    // to a legacy address so the upsert below can claim it. Any actual account
    // removal belongs in an explicit, audited admin flow, not silent sync.
    if (existingUserByEmail && existingUserByEmail.id !== user.id) {
      this.logger.warn(
        `Email conflict on sync email=${email} staleId=${existingUserByEmail.id} — renaming stale record`,
      );
      await this.prisma.user
        .update({
          where: { id: existingUserByEmail.id },
          data: { email: `legacy_${Date.now()}_${existingUserByEmail.email}` },
        })
        .catch((err) =>
          this.logger.error(
            `Failed to rename conflicting email record: ${err.message}`,
          ),
        );
    }

    // Resolve username conflict (if another user has the same username but a different email)
    let finalUsername = username;
    if (existingUserByUsername && existingUserByUsername.id !== user.id) {
      // randomInt, not Math.random: a predictable suffix lets an attacker who
      // knows a colliding username guess the handle the next signup will be
      // given, which is enough to squat it first.
      finalUsername = `${username}_${randomInt(100, 1000)}`;
    }

    const userBirthday = metaString(sbUser.user_metadata?.birthday);
    if (!userBirthday) {
      this.logger.warn(
        `Account creation rejected for ${email}: Date of birth is required.`,
      );
      throw new BadRequestException('Date of birth is required.');
    }
    validateBirthday(userBirthday);

    let userRecord: any;
    try {
      userRecord = await this.prisma.user.upsert({
        where: { id: user.id },
        update: {
          email: email,
          birthday: userBirthday,
        },
        create: {
          id: user.id,
          username: finalUsername,
          displayName,
          email: email,
          // Every new profile starts with the platform avatar default written
          // onto the row. Cover starts as null — the frontend renders the
          // theme-aware empty cover state via CSS (--empty-cover-bg).
          avatar:
            metaString(sbUser.user_metadata?.avatar) ??
            this.defaultAssets.refFor('profile-avatar'),
          cover: null,
          collegeId: collegeId,
          collegeEmail: email,
          birthday: userBirthday,
          settings: {
            create: {},
          },
          notificationPrefs: {
            create: {},
          },
        },
        include: {
          settings: true,
          college: { select: { id: true, name: true } },
          following: {
            select: {
              following: { select: { username: true } },
            },
          },
        },
      });
    } catch (err: any) {
      userRecord = await this.prisma.user.findUnique({
        where: { id: user.id },
        include: {
          settings: true,
          college: { select: { id: true, name: true } },
          following: {
            select: {
              following: { select: { username: true } },
            },
          },
        },
      });
      if (!userRecord) {
        throw err;
      }
    }

    this.logger.log(`User login ${userRecord.username}`);
    const followingList =
      userRecord.following?.map((f: any) => f.following.username) || [];
    const result = { ...userRecord, followingList };
    this.syncCache.set(user.id, { data: result, timestamp: Date.now() });
    return result;
  }

  /**
   * Server-side login proxy.
   *
   * Performance: at most ONE DB query (username→email resolution, skipped when an
   * email is supplied) plus ONE Supabase auth call. No profile fetch, no extra
   * reads. Profile hydration happens later via the client's SIGNED_IN → sync.
   *
   * Security:
   *  - The resolved email is never returned to the client (closes the
   *    username→email disclosure).
   *  - A missing username and a wrong password return the SAME generic error, so
   *    neither username nor email existence can be probed.
   *  - Brute-force throttling is enforced by LoginRateLimitGuard on the route.
   */
  async login(
    identifier: string,
    password: string,
  ): Promise<{
    session: {
      access_token: string;
      refresh_token: string;
      expires_at?: number;
      expires_in?: number;
      token_type?: string;
    };
    user: { id: string; email: string; displayName?: string };
  }> {
    if (!this.supabaseService.isConfigured) {
      throw new UnauthorizedException('Authentication is not configured.');
    }

    const raw = (identifier || '').trim();
    if (!raw || !password) {
      throw new UnauthorizedException('Invalid username/email or password.');
    }

    let email = raw.toLowerCase();
    // Resolve username → email internally. Never reveal whether it exists.
    if (!raw.includes('@')) {
      const found = await this.prisma.user.findUnique({
        where: { username: email },
        select: { email: true },
      });
      if (!found) {
        throw new UnauthorizedException('Invalid username/email or password.');
      }
      email = found.email;
    }

    const { data, error } =
      await this.supabaseService.client.auth.signInWithPassword({
        email,
        password,
      });

    if (error || !data?.session || !data?.user) {
      throw new UnauthorizedException('Invalid username/email or password.');
    }

    const { session, user } = data;
    return {
      session: {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: session.expires_at,
        expires_in: session.expires_in,
        token_type: session.token_type,
      },
      user: {
        id: user.id,
        email: user.email || email,
        displayName: (user.user_metadata as any)?.displayName,
      },
    };
  }

  async checkUsernameAvailability(
    username: string,
  ): Promise<{ available: boolean; reason?: string }> {
    const trimmed = (username || '').trim().toLowerCase();
    const usernameRegex = /^[a-z0-9_.]{3,30}$/;
    if (!usernameRegex.test(trimmed)) {
      return {
        available: false,
        reason:
          'Must be 3-30 characters with lowercase letters, numbers, _, or .',
      };
    }

    // Shared with the profile-rename path, which used to skip this check
    // entirely — see common/users/reserved-usernames.ts.
    if (isReservedUsername(trimmed)) {
      return { available: false, reason: RESERVED_USERNAME_MESSAGE };
    }

    const existing = await this.prisma.user.findUnique({
      where: { username: trimmed },
      select: { id: true },
    });

    if (existing) {
      return { available: false, reason: 'Username not available' };
    }

    return { available: true };
  }

  async checkEmailAvailability(
    email: string,
    collegeId?: string,
  ): Promise<{
    available: boolean;
    /**
     * Why the answer is no, as a stable token. The client keys its UI state off
     * this rather than off `reason`, which is prose and may be reworded.
     *
     *   invalid_email  the string is not an address
     *   domain_not_allowed  a real address, but not on an approved college domain
     *   email_taken  already registered
     */
    code?: 'invalid_email' | 'domain_not_allowed' | 'email_taken';
    reason?: string;
    collegeName?: string;
    collegeId?: string;
  }> {
    // Cheapest check first — reject malformed input before any DB / domain work.
    //
    // Answered as a 200 with `available: false`, not thrown. A malformed address
    // is a legitimate answer to "can I register this?", and the client needs to
    // tell it apart from a transport failure. When this came back as a 400 the
    // client's catch block could not distinguish the two, called it a network
    // error, and offered to let the user continue anyway.
    const format = checkEmailFormat(email);
    if (!format.valid) {
      return {
        available: false,
        code: 'invalid_email',
        reason:
          format.code === EmailFormat.Required
            ? 'Email address is required.'
            : 'Please enter a valid email address.',
      };
    }
    const trimmed = normalizeEmail(email);

    const domain = trimmed.split('@')[1] || '';

    // If collegeId is provided, get target college name for clearer error messaging
    let targetCollegeName: string | undefined;
    if (collegeId) {
      const targetCollege = await this.prisma.college.findUnique({
        where: { id: collegeId },
        select: { name: true, shortName: true },
      });
      if (targetCollege) {
        targetCollegeName = targetCollege.shortName || targetCollege.name;
      }
    }

    // Domain gating (approved-college check) — served from an O(1) in-memory cache.
    const domainValidation =
      await this.domainValidatorService.validateDomain(trimmed);
    if (!domainValidation.isValid) {
      if (targetCollegeName) {
        const commonCommercialDomains = [
          'gmail.com',
          'yahoo.com',
          'outlook.com',
          'hotmail.com',
          'icloud.com',
          'protonmail.com',
          'zoho.com',
          'mail.com',
          'aol.com',
        ];
        return {
          available: false,
          code: 'domain_not_allowed',
          reason: `Please use your official ${targetCollegeName} email.`,
        };
      }
      return {
        available: false,
        code: 'domain_not_allowed',
        reason: 'Please select your college first.',
      };
    }

    // Check collegeId match if collegeId was provided
    if (collegeId && domainValidation.info?.collegeId !== collegeId) {
      const emailCollegeName =
        domainValidation.info?.collegeName || 'another institution';
      return {
        available: false,
        code: 'domain_not_allowed',
        reason: `This email belongs to ${emailCollegeName}. Please enter your official ${targetCollegeName || 'college'} email.`,
      };
    }

    // Existence check. Emails are stored already-lowercased (Supabase normalizes
    // them and we persist the normalized value), so an exact match lets Postgres
    // use the unique index on `email` and the index on `collegeEmail` instead of
    // a case-insensitive sequential scan over the whole User table.
    const existingPrismaUser = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: trimmed }, { collegeEmail: trimmed }],
      },
      select: { id: true },
    });

    if (existingPrismaUser) {
      return {
        available: false,
        code: 'email_taken',
        reason: 'This email is already registered. Please sign in.',
      };
    }

    return {
      available: true,
      collegeId: domainValidation.info?.collegeId,
      collegeName: domainValidation.info?.collegeName,
    };
  }

  /** Returns only the IDs of posts the user has bookmarked — fast select, bundled into auth sync. */
  async getPostBookmarkIds(userId: string): Promise<string[]> {
    try {
      const rows = await this.prisma.postBookmark.findMany({
        where: { userId },
        select: { postId: true },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      return rows.map((r) => r.postId);
    } catch {
      return [];
    }
  }

  /** Returns only the IDs of activities the user has bookmarked — fast select, bundled into auth sync. */
  async getActivityBookmarkIds(userId: string): Promise<string[]> {
    try {
      const rows = await this.prisma.activityBookmark.findMany({
        where: { userId },
        select: { activityId: true },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      return rows.map((r) => r.activityId);
    } catch {
      return [];
    }
  }

  /**
   * Whether an account exists for this address, as a plain boolean.
   *
   * Deliberately narrower than `findUserByEmail` below: the forgot-password
   * screen only needs to know whether to say "No account found", and returning
   * the row would hand an unauthenticated caller a display name and username
   * for any address they guessed.
   *
   * This does make account existence observable, which is a change from the
   * previous always-say-"check your email" behaviour. That was a deliberate
   * anti-enumeration measure and giving it up is a product decision, not an
   * oversight — the rate-limit guard on the route is what keeps it from being
   * a usable bulk oracle.
   */
  async accountExistsForEmail(email: string): Promise<{ exists: boolean }> {
    const trimmed = (email || '').trim().toLowerCase();
    if (!trimmed) return { exists: false };

    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: { equals: trimmed, mode: 'insensitive' } },
          { collegeEmail: { equals: trimmed, mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    });

    return { exists: Boolean(user) };
  }

  /** Returns user if account exists, or throws NotFoundException if account does not exist. */
  async findUserByEmail(email: string) {
    const trimmed = (email || '').trim().toLowerCase();
    if (!trimmed) {
      throw new BadRequestException('Please enter a valid email address.');
    }

    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: { equals: trimmed, mode: 'insensitive' } },
          { collegeEmail: { equals: trimmed, mode: 'insensitive' } },
        ],
      },
      select: { id: true, email: true, displayName: true, username: true },
    });

    if (!user) {
      throw new NotFoundException('No account found with this email address.');
    }

    return user;
  }

  private async _getUnreadNotifCount(userId: string): Promise<number> {
    const redis = this.redisService?.getClient();
    const redisKey = `notifications:unread:${userId}`;
    if (redis) {
      try {
        const cached = await redis.get(redisKey);
        if (cached !== null && cached !== undefined) {
          return parseInt(cached, 10);
        }
      } catch {}
    }

    const count = await this.prisma.notification
      .count({
        where: {
          recipientId: userId,
          readAt: null,
          deletedAt: null,
          type: { not: 'MESSAGE' as any },
        },
      })
      .catch(() => 0);

    if (redis) {
      redis.set(redisKey, count.toString(), 'EX', 3600).catch(() => {});
    }
    return count;
  }

  async createCollegeRequest(dto: {
    name: string;
    collegeName: string;
    collegeEmail: string;
    personalEmail: string;
  }) {
    const sanitizeStr = (str: string) =>
      (str || '')
        .replace(/<[^>]*>?/g, '')
        .replace(/[\u200B-\u200D\uFEFF\u0000-\u001F\u007F-\u009F]/g, '')
        .trim();

    const name = sanitizeStr(dto.name);
    const collegeName = sanitizeStr(dto.collegeName);
    const collegeEmail = sanitizeStr(dto.collegeEmail).toLowerCase();
    const personalEmail = sanitizeStr(dto.personalEmail).toLowerCase();

    if (!name || name.length < 2 || name.length > 80) {
      throw new BadRequestException(
        'Please enter a valid full name (2-80 characters).',
      );
    }
    if (!collegeName || collegeName.length < 3 || collegeName.length > 120) {
      throw new BadRequestException(
        'Please enter a valid college name (3-120 characters).',
      );
    }
    if (
      !personalEmail ||
      !personalEmail.includes('@') ||
      personalEmail.length > 100
    ) {
      throw new BadRequestException(
        'Please enter a valid personal email address.',
      );
    }
    if (
      !collegeEmail ||
      !collegeEmail.includes('@') ||
      collegeEmail.length > 100
    ) {
      throw new BadRequestException(
        'Please enter a valid college email address.',
      );
    }

    return this.prisma.collegeRequest.create({
      data: {
        name,
        collegeName,
        collegeEmail,
        personalEmail,
        status: 'PENDING',
      },
    });
  }
}
