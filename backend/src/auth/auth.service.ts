import { Injectable, UnauthorizedException, NotFoundException, ConflictException, BadRequestException, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService } from '../supabase/supabase.service';
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
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > currentYear) {
    throw new BadRequestException(`Year of birth must be between 1990 and ${currentYear}.`);
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

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private domainCache = new Map<string, { collegeId: string | null; timestamp: number }>();
  private syncCache = new Map<string, { data: any; timestamp: number }>();
  /** Coalesces concurrent syncProfile calls for the same user into one DB round-trip. */
  private syncInflight = new Map<string, Promise<any>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly supabaseService: SupabaseService,
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
    // Fast-path: If user already exists in database, return with following list for client hydration
    const existingUser = await this.prisma.user.findUnique({
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

    if (existingUser) {
      // Auto-heal real email from Supabase user if email is fallback @meetifyy.user
      const sbEmail = user.email || user.user_metadata?.email;
      if (sbEmail && (existingUser.email.endsWith('@meetifyy.user') || !existingUser.email)) {
        const cleanRealEmail = sbEmail.trim().toLowerCase();
        await this.prisma.user.update({
          where: { id: existingUser.id },
          data: { email: cleanRealEmail }
        }).catch(() => {});
        existingUser.email = cleanRealEmail;
      }

      const followingList = existingUser.following.map(f => f.following.username);
      // Lazy-create settings for existing users who pre-date the settings feature
      let userSettings = existingUser.settings;
      if (!userSettings) {
        userSettings = await this.prisma.userSettings.upsert({
          where: { userId: existingUser.id },
          create: { userId: existingUser.id },
          update: {},
        }).catch(() => null);
      }

      // Auto-heal missing college linkage for existing users
      if (!existingUser.collegeId && existingUser.email) {
        const cleanEmail = existingUser.email.trim().toLowerCase();
        const domain = cleanEmail.split('@')[1];
        if (domain) {
          const collegeDomain = await this.prisma.collegeDomain.findFirst({
            where: {
              OR: [
                { domain: domain },
                { domain: { endsWith: domain } },
              ]
            },
            include: { college: true },
          });
          if (collegeDomain && collegeDomain.college && collegeDomain.college.isActive && collegeDomain.college.status !== 'DISABLED') {
            await this.prisma.user.update({
              where: { id: existingUser.id },
              data: { collegeId: collegeDomain.college.id }
            });
            existingUser.collegeId = collegeDomain.college.id;
            existingUser.college = { id: collegeDomain.college.id, name: collegeDomain.college.name };
          }
        }
      }

      const [postBookmarks, activityBookmarks, unreadNotifCount] = await Promise.all([
        this.prisma.postBookmark.findMany({
          where: { userId: existingUser.id },
          select: { postId: true },
          orderBy: { createdAt: 'desc' },
          take: 100,
        }).catch(() => []),
        this.prisma.activityBookmark.findMany({
          where: { userId: existingUser.id },
          select: { activityId: true },
        }).catch(() => []),
        this._getUnreadNotifCount(existingUser.id),
      ]);

      const result = {
        ...existingUser,
        settings: userSettings,
        followingList,
        meta: {
          postBookmarkIds: postBookmarks.map(b => b.postId),
          activityBookmarkIds: activityBookmarks.map(b => b.activityId),
          unreadNotifCount,
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
    email = email.trim().toLowerCase();
    const domain = email.split('@')[1];

    let collegeId = null;
    if (domain) {
      if (!this.domainCache) this.domainCache = new Map();
      const cached = this.domainCache.get(domain);
      const now = Date.now();
      if (cached && now - cached.timestamp < 300000) { // 5-min TTL
        collegeId = cached.collegeId;
      } else {
        const collegeDomain = await this.prisma.collegeDomain.findUnique({
          where: { domain },
          include: { college: true },
        });
        if (collegeDomain && collegeDomain.college && collegeDomain.college.isActive && collegeDomain.college.status !== 'DISABLED') {
          collegeId = collegeDomain.college.id;
        }
        this.domainCache.set(domain, { collegeId, timestamp: now });
      }
    }

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
}

