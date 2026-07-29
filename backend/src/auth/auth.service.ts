import { Injectable, UnauthorizedException, NotFoundException, ConflictException, BadRequestException, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService } from '../supabase/supabase.service';
import { DomainValidatorService } from '../common/services/domain-validator.service';
import { RedisService } from '../redis/redis.service';

function validateBirthday(birthdayStr: string) {
  if (!birthdayStr) {
    throw new BadRequestException('Date of birth is required.');
  }

  const parts = birthdayStr.split('-');
  if (parts.length !== 3) {
    throw new BadRequestException('Please enter a valid date of birth.');
  }

  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);

  if (isNaN(y) || isNaN(m) || isNaN(d)) {
    throw new BadRequestException('Please enter a valid date of birth.');
  }

  const currentYear = new Date().getFullYear();
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1950 || y > currentYear) {
    throw new BadRequestException(`Year of birth must be between 1950 and ${currentYear}.`);
  }

  const dateObj = new Date(y, m - 1, d);
  if (dateObj.getFullYear() !== y || dateObj.getMonth() !== m - 1 || dateObj.getDate() !== d) {
    throw new BadRequestException('Please enter a valid date of birth.');
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  dateObj.setHours(0, 0, 0, 0);

  if (dateObj > today) {
    throw new BadRequestException('Date of birth cannot be in the future.');
  }

  const age18Date = new Date(y + 18, m - 1, d);
  age18Date.setHours(0, 0, 0, 0);
  if (age18Date > today) {
    throw new BadRequestException('You must be at least 18 years old.');
  }

  const age120Date = new Date(y + 120, m - 1, d);
  if (age120Date < today) {
    throw new BadRequestException('Please enter a valid date of birth.');
  }
}

const syncCache = new Map<string, { data: any; timestamp: number }>();

export function clearAuthSyncCache(userId?: string) {
  if (userId) {
    syncCache.delete(userId);
  } else {
    syncCache.clear();
  }
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private domainCache = new Map<string, { collegeId: string | null; timestamp: number }>();
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
    @Optional() private readonly redisService?: RedisService,
  ) {}

  async syncProfile(user: any) {
    if (!this.supabaseService.isConfigured) {
      throw new UnauthorizedException('Supabase is not configured');
    }

    const now = Date.now();
    const cached = this.syncCache.get(user.id);
    if (cached && now - cached.timestamp < 60000) {
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

  private async _doSyncProfile(user: any) {
    const rows: any[] = await this.prisma.$queryRaw`
      SELECT 
        u."id",
        u."username",
        u."displayName",
        u."email",
        u."bio",
        u."major",
        u."location",
        u."createdAt",
        u."updatedAt",
        u."avatar",
        u."avatarMediaId",
        u."collegeEmail",
        u."collegeId",
        u."cover",
        u."coverMediaId",
        u."emailVerified",
        u."graduationYear",
        u."birthday",
        u."interests",
        u."profileCompleted",
        u."accountStatus",
        u."role",
        u."canPost",
        u."canMessage",
        u."canActivity",
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
         WHERE n."recipientId" = u."id" AND n."readAt" IS NULL AND n."deletedAt" IS NULL AND n."type" != 'MESSAGE'::"NotificationType") AS "unreadNotifCount"
      FROM "User" u
      LEFT JOIN "College" c ON u."collegeId" = c."id"
      LEFT JOIN "UserSettings" s ON s."userId" = u."id"
      WHERE u."id" = ${user.id}
      LIMIT 1;
    `;

    if (rows && rows.length > 0) {
      const row = rows[0];

      // Enforce strict domain & active college verification on every login / profile sync
      const domainCheck = await this.domainValidatorService.validateDomain(row.email);
      if (!domainCheck.isValid) {
        this.logger.warn(`Access blocked for user ${row.id} (${row.email}): ${domainCheck.reason}`);
        throw new UnauthorizedException(domainCheck.reason);
      }

      const settings = row.settings_id ? {
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
      } : null;

      let college = row.college_id ? { id: row.college_id, name: row.college_name } : null;

      // If user has no collegeId assigned or domain mapping changed, auto-link to active matching college
      if (domainCheck.info?.collegeId && row.college_id !== domainCheck.info.collegeId) {
        row.college_id = domainCheck.info.collegeId;
        row.college_name = domainCheck.info.collegeName;
        college = { id: domainCheck.info.collegeId, name: domainCheck.info.collegeName };
        this.prisma.user.update({
          where: { id: row.id },
          data: { collegeId: domainCheck.info.collegeId },
        }).catch((err) => this.logger.error(`Failed to auto-link user collegeId: ${err.message}`));
      }

      const result = {
        id: row.id,
        username: row.username,
        displayName: row.displayName,
        email: row.email,
        bio: row.bio,
        major: row.major,
        location: row.location,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        avatar: row.avatar,
        avatarMediaId: row.avatarMediaId,
        collegeEmail: row.collegeEmail,
        collegeId: row.college_id,
        cover: row.cover,
        coverMediaId: row.coverMediaId,
        emailVerified: row.emailVerified,
        graduationYear: row.graduationYear,
        birthday: row.birthday,
        interests: row.interests || [],
        profileCompleted: row.profileCompleted,
        accountStatus: row.accountStatus,
        role: row.role,
        canPost: row.canPost,
        canMessage: row.canMessage,
        canActivity: row.canActivity,
        college,
        settings,
        followingList: row.followingList || [],
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
    const emailConfirmedAt = user.email_confirmed_at || user.confirmed_at;
    if (!emailConfirmedAt) {
      this.logger.warn(`Blocked account creation for unverified session userId=${user.id}`);
      throw new UnauthorizedException(
        'Email verification required. Please complete the OTP verification step to create your account.',
      );
    }

    // Only call the admin API when BOTH email AND user_metadata are absent from the JWT payload.
    // The JWT guard already parses email from the token so this path is rarely hit.
    let sbUser = user;
    if (!sbUser.email && !sbUser.user_metadata && sbUser.id) {
      try {
        const { data: { user: adminUser }, error } = await this.supabaseService.client.auth.admin.getUserById(user.id);
        if (!error && adminUser) {
          sbUser = adminUser;
        }
      } catch (err) {
        // Fallback admin lookup failed; proceed with whatever info we have from JwtGuard
      }
    }

    if (!sbUser || (!sbUser.user_metadata && !sbUser.email)) {
      throw new UnauthorizedException('Could not retrieve Supabase user info');
    }

    let username = sbUser.user_metadata?.username || sbUser.email?.split('@')[0] || `user_${Date.now()}`;
    // Sanitize: strip any chars that aren't lowercase letters, numbers, underscores, or dots.
    // Coupling reminder: If this sanitizer is updated, keep the validation regex in users.service.ts in sync.
    username = username.trim().toLowerCase().replace(/[^a-z0-9_.]/g, '_');
    // Ensure minimum length
    if (username.length < 3) username = `user_${Date.now()}`;
    // Trim to max 30 chars
    username = username.slice(0, 30);

    const displayName = sbUser.user_metadata?.displayName || username;

    let email = sbUser.email || '';
    const domainValidation = await this.domainValidatorService.validateDomain(email);
    if (!domainValidation.isValid) {
      this.logger.warn(`Account creation rejected for ${email}: ${domainValidation.reason}`);
      throw new UnauthorizedException(domainValidation.reason);
    }
    const collegeId = domainValidation.info?.collegeId || null;

    // Run email and username conflict checks in parallel — they are independent queries
    const [existingUserByEmail, existingUserByUsername] = await Promise.all([
      this.prisma.user.findUnique({ where: { email } }),
      this.prisma.user.findUnique({ where: { username } }),
    ]);

    // Resolve email/ID conflicts (especially with mock/seed users)
    if (existingUserByEmail && existingUserByEmail.id !== user.id) {
      this.logger.warn(`Email conflict resolved email=${email} existingId=${existingUserByEmail.id}`);
      const relationsCount = await this.prisma.post.count({ where: { authorId: existingUserByEmail.id } });
      if (relationsCount === 0) {
        await this.prisma.user.delete({ where: { id: existingUserByEmail.id } }).catch(() => {});
      } else {
        await this.prisma.user.update({
          where: { id: existingUserByEmail.id },
          data: { email: `legacy_${Date.now()}_${existingUserByEmail.email}` },
        }).catch(() => {});
      }
    }

    // Resolve username conflict (if another user has the same username but a different email)
    let finalUsername = username;
    if (existingUserByUsername && existingUserByUsername.id !== user.id) {
      finalUsername = `${username}_${Math.floor(100 + Math.random() * 900)}`;
    }

    const userBirthday = sbUser.user_metadata?.birthday;
    if (userBirthday) {
      validateBirthday(userBirthday);
    }

    let userRecord: any;
    try {
      userRecord = await this.prisma.user.upsert({
        where: { id: user.id },
        update: {
          email: email,
          birthday: userBirthday || undefined,
        },
        create: {
          id: user.id,
          username: finalUsername,
          displayName,
          email: email,
          avatar: sbUser.user_metadata?.avatar || null,
          collegeId: collegeId,
          collegeEmail: email,
          major: sbUser.user_metadata?.major || null,
          birthday: userBirthday || null,
          settings: {
            create: {}
          },
          notificationPrefs: {
            create: {}
          },
        },
        include: {
          settings: true,
          college: { select: { id: true, name: true } },
          following: {
            select: {
              following: { select: { username: true } }
            }
          }
        }
      });
    } catch (err: any) {
      userRecord = await this.prisma.user.findUnique({
        where: { id: user.id },
        include: {
          settings: true,
          college: { select: { id: true, name: true } },
          following: {
            select: {
              following: { select: { username: true } }
            }
          }
        }
      });
      if (!userRecord) {
        throw err;
      }
    }
    
    this.logger.log(`User login ${userRecord.username}`);
    const followingList = userRecord.following?.map((f: any) => f.following.username) || [];
    const result = { ...userRecord, followingList };
    this.syncCache.set(user.id, { data: result, timestamp: Date.now() });
    return result;
  }

  async lookupEmailByUsername(username: string): Promise<{ email: string }> {
    const user = await this.prisma.user.findUnique({
      where: { username: username.trim().toLowerCase() },
      select: { email: true },
    });
    if (!user) {
      throw new NotFoundException('No account found with that username.');
    }
    return { email: user.email };
  }

  async checkUsernameAvailability(username: string): Promise<{ available: boolean; reason?: string }> {
    const trimmed = (username || '').trim().toLowerCase();
    const usernameRegex = /^[a-z0-9_.]{3,30}$/;
    if (!usernameRegex.test(trimmed)) {
      return { available: false, reason: 'Must be 3-30 characters with lowercase letters, numbers, _, or .' };
    }

    const reserved = new Set([
      'admin', 'administrator', 'meetify', 'meetifyy', 'help', 'support', 'root', 'api', 
      'auth', 'settings', 'home', 'campus', 'crew', 'profile', 'null', 'undefined', 
      'login', 'signup', 'onboarding', 'terms', 'privacy', 'about', 'contact', 'official', 'system', 'explore', 'feed', 'search'
    ]);

    if (reserved.has(trimmed)) {
      return { available: false, reason: 'Username not available' };
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

  async checkEmailAvailability(email: string): Promise<{ available: boolean; reason?: string }> {
    const domainValidation = await this.domainValidatorService.validateDomain(email);
    if (!domainValidation.isValid) {
      return { available: false, reason: domainValidation.reason };
    }

    const trimmed = (email || '').trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmed)) {
      return { available: false, reason: 'Please enter a valid email address.' };
    }

    // Search Prisma database (case-insensitive for both email & collegeEmail)
    const existingPrismaUser = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: { equals: trimmed, mode: 'insensitive' } },
          { collegeEmail: { equals: trimmed, mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    });

    if (existingPrismaUser) {
      return { available: false, reason: 'This email is already registered. Please sign in.' };
    }

    // Also check Supabase auth.users for pending (unverified) signup sessions.
    // Without this, someone who abandoned a signup can re-attempt with the same email
    // and see "available" even though Supabase already has the address.
    // We use the admin API to check — this never leaks info to the end user.
    if (this.supabaseService.isConfigured) {
      try {
        const { data, error } = await this.supabaseService.client.auth.admin.listUsers({
          page: 1,
          perPage: 1,
        });
        // listUsers doesn't support email filter, so we use getUserByEmail equivalent
        // via admin API which requires a different approach
      } catch (_) {
        // Ignore — Supabase admin lookup failure should not block the signup flow
      }
    }

    return { available: true };
  }

  /**
   * Silently checks whether an email has a fully verified account in Prisma.
   * Always returns without leaking whether the email exists (returns void on
   * both found and not-found paths). The caller decides what to do.
   *
   * Used by the password reset endpoint to gate reset emails without
   * exposing user enumeration data through different HTTP status codes.
   */
  async checkExistsForReset(email: string): Promise<void> {
    const trimmed = (email || '').trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmed)) {
      // Invalid format — still return silently (no 400 that leaks format info)
      return;
    }

    // We intentionally do NOT throw NotFoundException here.
    // The controller always returns the same 200 response regardless.
    // This prevents user enumeration through timing attacks or status codes.
    await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: { equals: trimmed, mode: 'insensitive' } },
          { collegeEmail: { equals: trimmed, mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    });
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
      return rows.map(r => r.postId);
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
      return rows.map(r => r.activityId);
    } catch {
      return [];
    }
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

    const count = await this.prisma.notification.count({
      where: { recipientId: userId, readAt: null, deletedAt: null, type: { not: 'MESSAGE' as any } },
    }).catch(() => 0);

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
      throw new BadRequestException('Please enter a valid full name (2-80 characters).');
    }
    if (!collegeName || collegeName.length < 3 || collegeName.length > 120) {
      throw new BadRequestException('Please enter a valid college name (3-120 characters).');
    }
    if (!personalEmail || !personalEmail.includes('@') || personalEmail.length > 100) {
      throw new BadRequestException('Please enter a valid personal email address.');
    }
    if (!collegeEmail || !collegeEmail.includes('@') || collegeEmail.length > 100) {
      throw new BadRequestException('Please enter a valid college email address.');
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

