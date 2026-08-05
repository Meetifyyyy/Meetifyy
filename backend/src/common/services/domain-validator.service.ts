import { Injectable, OnModuleInit, Logger, BadRequestException, Optional } from '@nestjs/common';
import { domainToASCII } from 'node:url';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';

export interface ApprovedDomainInfo {
  id: string;
  collegeId: string;
  collegeName: string;
  collegeStatus: string;
  collegeIsActive: boolean;
  domain: string;
  isPrimary: boolean;
  isVerified: boolean;
  status: string;
}

@Injectable()
export class DomainValidatorService implements OnModuleInit {
  private readonly logger = new Logger(DomainValidatorService.name);

  // High-performance in-memory cache map (O(1) lookup < 1ms)
  private domainCache = new Map<string, ApprovedDomainInfo>();
  private lastCacheTime = 0;
  private readonly CACHE_TTL_MS = 60000; // 1 minute safety TTL before background refresh

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly redisService?: RedisService,
  ) {}

  async onModuleInit() {
    await this.refreshDomainCache();
  }

  /**
   * Normalizes an email or domain string securely to prevent bypasses:
   * - Strips zero-width chars, spaces, control chars, newlines
   * - Unicode NFKC normalization
   * - Converts IDN / Punycode to ASCII lowercase
   * - Strips trailing dots
   */
  normalizeDomain(rawDomain: string): string {
    if (!rawDomain || typeof rawDomain !== 'string') {
      throw new BadRequestException('Invalid email domain format.');
    }

    // Strip invisible characters, tabs, newlines, null bytes, zero-width spaces
    let cleaned = rawDomain
      .replace(/[\u200B-\u200D\uFEFF\u0000-\u001F\u007F-\u009F\s]/g, '')
      .normalize('NFKC')
      .trim()
      .toLowerCase();

    if (cleaned.endsWith('.')) {
      cleaned = cleaned.slice(0, -1);
    }

    if (!cleaned || cleaned.length > 253) {
      throw new BadRequestException('Invalid domain format or length.');
    }

    // Convert domain to ASCII using official WHATWG domainToASCII parser
    const asciiDomain = domainToASCII(cleaned);
    if (!asciiDomain || asciiDomain.includes(' ') || asciiDomain.includes('/')) {
      throw new BadRequestException('Invalid email domain structure.');
    }

    return asciiDomain;
  }

  /**
   * Extracts and normalizes domain from email string safely.
   */
  extractDomainFromEmail(email: string): string {
    if (!email || typeof email !== 'string') {
      throw new BadRequestException('Email address is required.');
    }

    // Strip spaces and invisible characters
    const sanitizedEmail = email
      .replace(/[\u200B-\u200D\uFEFF\u0000-\u001F\u007F-\u009F]/g, '')
      .normalize('NFKC')
      .trim();

    // Check for single @ symbol
    const parts = sanitizedEmail.split('@');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new BadRequestException('Please enter a valid email address format.');
    }

    const localPart = parts[0];
    const rawDomain = parts[1];

    // Local part validation (no control chars or invalid spaces)
    if (/[\s\r\n]/.test(localPart)) {
      throw new BadRequestException('Invalid character in email address.');
    }

    return this.normalizeDomain(rawDomain);
  }

  /**
   * Refreshes the domain cache from PostgreSQL and syncs to Redis.
   */
  async refreshDomainCache(): Promise<void> {
    try {
      const activeDomains = await this.prisma.collegeDomain.findMany({
        where: {
          status: 'ACTIVE',
          college: {
            deletedAt: null,
            isActive: true,
            status: 'APPROVED',
          },
        },
        include: {
          college: {
            select: {
              id: true,
              name: true,
              status: true,
              isActive: true,
              deletedAt: true,
            },
          },
        },
      });

      const newMap = new Map<string, ApprovedDomainInfo>();
      for (const d of activeDomains) {
        const normalized = this.normalizeDomain(d.domain);
        const info: ApprovedDomainInfo = {
          id: d.id,
          collegeId: d.collegeId,
          collegeName: d.college.name,
          collegeStatus: d.college.status,
          collegeIsActive: d.college.isActive,
          domain: normalized,
          isPrimary: d.isPrimary,
          isVerified: d.isVerified,
          status: d.status,
        };
        newMap.set(normalized, info);
      }

      this.domainCache = newMap;
      this.lastCacheTime = Date.now();
      this.logger.log(`Domain cache reloaded with ${newMap.size} active approved domains.`);

      // Sync to Redis if available for multi-instance horizontal scaling
      const redis = this.redisService?.getClient();
      if (redis) {
        const pipeline = redis.pipeline();
        pipeline.del('cache:approved_domains');
        for (const [dom, info] of newMap.entries()) {
          pipeline.hset('cache:approved_domains', dom, JSON.stringify(info));
        }
        // C-5 fix: Always set a TTL on the HASH so removed domains don't persist
        // indefinitely if refreshDomainCache fails before the next scheduled run.
        pipeline.expire('cache:approved_domains', 300); // 5-minute safety TTL
        await pipeline.exec().catch((err) => {
          this.logger.warn(`Redis sync error for approved domains: ${err.message}`);
        });
      }
    } catch (err: any) {
      this.logger.error(`Failed to refresh domain cache: ${err.message}`, err.stack);
    }
  }

  /**
   * Immediately invalidates and reloads domain cache across all instances.
   */
  async invalidateCache(): Promise<void> {
    await this.refreshDomainCache();
    // Publish Redis pub/sub event to notify other cluster nodes if present
    const redis = this.redisService?.getClient();
    if (redis) {
      redis.publish('cache:invalidate_domains', 'reload').catch(() => {});
    }
  }

  /**
   * Fast sub-50ms O(1) domain lookup and validation.
   * Checks if domain is active and belongs to an active, approved college.
   */
  async validateDomain(domainOrEmail: string): Promise<{
    isValid: boolean;
    info?: ApprovedDomainInfo;
    reason?: string;
  }> {
    let domain: string;
    try {
      domain = domainOrEmail.includes('@')
        ? this.extractDomainFromEmail(domainOrEmail)
        : this.normalizeDomain(domainOrEmail);
    } catch (err: any) {
      return { isValid: false, reason: err.message || 'Invalid email format' };
    }

    // Refresh memory cache if TTL expired
    if (Date.now() - this.lastCacheTime > this.CACHE_TTL_MS) {
      await this.refreshDomainCache();
    }

    // Check memory cache first (sub-1ms O(1) lookup)
    let info = this.domainCache.get(domain);

    // If not found in local memory, fallback to single DB lookup to guard against cache miss
    if (!info) {
      const dbDomain = await this.prisma.collegeDomain.findFirst({
        where: {
          domain,
          status: 'ACTIVE',
          college: {
            deletedAt: null,
            isActive: true,
            status: 'APPROVED',
          },
        },
        include: {
          college: {
            select: {
              id: true,
              name: true,
              status: true,
              isActive: true,
            },
          },
        },
      });

      if (dbDomain && dbDomain.college) {
        info = {
          id: dbDomain.id,
          collegeId: dbDomain.collegeId,
          collegeName: dbDomain.college.name,
          collegeStatus: dbDomain.college.status,
          collegeIsActive: dbDomain.college.isActive,
          domain: this.normalizeDomain(dbDomain.domain),
          isPrimary: dbDomain.isPrimary,
          isVerified: dbDomain.isVerified,
          status: dbDomain.status,
        };
        // Add to memory cache
        this.domainCache.set(domain, info);
      }
    }

    if (!info) {
      return {
        isValid: false,
        reason: `Domain '${domain}' is not an approved college email.`,
      };
    }

    if (info.status !== 'ACTIVE') {
      return {
        isValid: false,
        reason: `The domain '${domain}' has been disabled by an administrator.`,
      };
    }

    if (!info.collegeIsActive || info.collegeStatus !== 'APPROVED') {
      return {
        isValid: false,
        reason: `Your institution '${info.collegeName}' is currently inactive or suspended.`,
      };
    }

    return { isValid: true, info };
  }
}
