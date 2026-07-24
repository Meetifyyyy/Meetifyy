import { Injectable, UnauthorizedException, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private domainCache = new Map<string, { collegeId: string | null; timestamp: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly supabaseService: SupabaseService,
  ) {}

  async syncProfile(user: any) {
    if (!this.supabaseService.isConfigured) {
      throw new UnauthorizedException('Supabase is not configured');
    }

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
      const followingList = existingUser.following.map(f => f.following.username);
      // Lazy-create settings for existing users who pre-date the settings feature
      let userSettings = existingUser.settings;
      if (!userSettings) {
        userSettings = await this.prisma.userSettings.create({ data: { userId: existingUser.id } }).catch(() => null);
      }
      return { ...existingUser, settings: userSettings, followingList };
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

    const userRecord = await this.prisma.user.upsert({
      where: { id: user.id },
      update: {
        email: email,
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
    
    this.logger.log(`User login ${userRecord.username}`);
    const followingList = userRecord.following?.map(f => f.following.username) || [];
    return { ...userRecord, followingList };
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

    // 1. Search Prisma database (case-insensitive for both email & collegeEmail)
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

    // 2. Check Supabase Auth user directory if Supabase is configured
    if (this.supabaseService.isConfigured) {
      try {
        const { data, error } = await this.supabaseService.client.auth.admin.listUsers();
        if (!error && data?.users) {
          const existsInSupabase = data.users.some(
            (u) => u.email?.trim().toLowerCase() === trimmed,
          );
          if (existsInSupabase) {
            return { available: false, reason: 'This email is already registered. Please sign in.' };
          }
        }
      } catch (err) {
        // Fallback silently if admin API call fails
      }
    }

    return { available: true };
  }
}
