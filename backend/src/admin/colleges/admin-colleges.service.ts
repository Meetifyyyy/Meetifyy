import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DomainValidatorService } from '../../common/services/domain-validator.service';
import { MediaCleanupService } from '../../uploads/media-cleanup.service';
import { Optional } from '@nestjs/common';

@Injectable()
export class AdminCollegesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly domainValidatorService: DomainValidatorService,
    @Optional() private readonly mediaCleanupService?: MediaCleanupService,
  ) {}

  private async notifyCacheChange() {
    await this.domainValidatorService.invalidateCache().catch(() => {});
  }

  private async deleteSoftDeletedDomains(
    domains: string[],
    excludeCollegeId?: string,
  ) {
    if (!domains || domains.length === 0) return;
    const softDeletedColleges = await this.prisma.college.findMany({
      where: {
        deletedAt: { not: null },
        ...(excludeCollegeId ? { id: { not: excludeCollegeId } } : {}),
      },
      select: { id: true },
    });
    const softDeletedIds = softDeletedColleges.map((c) => c.id);
    if (softDeletedIds.length > 0) {
      await this.prisma.collegeDomain.deleteMany({
        where: {
          domain: { in: domains },
          collegeId: { in: softDeletedIds },
        },
      });
    }
  }

  async listColleges(query: {
    search?: string;
    status?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: any = {};

    if (query.status === 'DELETED') {
      where.deletedAt = { not: null };
    } else {
      where.deletedAt = null;
      if (query.status) {
        where.status = query.status;
      }
    }

    if (query.search) {
      let normalizedSearch = query.search;
      try {
        normalizedSearch = this.domainValidatorService.normalizeDomain(
          query.search,
        );
      } catch {
        normalizedSearch = query.search;
      }
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { shortName: { contains: query.search, mode: 'insensitive' } },
        { city: { contains: query.search, mode: 'insensitive' } },
        {
          domains: {
            some: {
              domain: { contains: normalizedSearch, mode: 'insensitive' },
            },
          },
        },
      ];
    }

    const [total, colleges, statusCounts, domainCount, studentCount] = await Promise.all([
      this.prisma.college.count({ where }),
      this.prisma.college.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
        include: {
          domains: {
            orderBy: { isPrimary: 'desc' },
          },
          _count: {
            select: { users: true },
          },
        },
      }),
      // Directory-wide figures for the header cards. Summing the current page
      // made "Domains" and "Enrolled Students" describe 20 colleges while being
      // presented as directory totals.
      this.prisma.college.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
      this.prisma.collegeDomain.count({ where: { college: where } }),
      this.prisma.user.count({ where: { college: where } }),
    ]);

    const byStatus = statusCounts.reduce<Record<string, number>>(
      (acc, row) => ({ ...acc, [String(row.status)]: row._count._all }),
      {},
    );

    return {
      data: colleges,
      meta: {
        total,
        counts: {
          byStatus,
          approved: byStatus.APPROVED || 0,
          domains: domainCount,
          students: studentCount,
        },
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getCollegeById(id: string) {
    const college = await this.prisma.college.findUnique({
      where: { id },
      include: {
        domains: {
          orderBy: { isPrimary: 'desc' },
        },
        _count: {
          select: { users: true },
        },
      },
    });

    if (!college || college.deletedAt) {
      throw new NotFoundException(`College with ID ${id} not found`);
    }

    return college;
  }

  async createCollege(dto: {
    name: string;
    shortName?: string;
    slug?: string;
    domains: string[];
    city?: string;
    state?: string;
    country?: string;
    logoKey?: string;
    bannerKey?: string;
    isPrivate?: boolean;
  }) {
    const slug = (dto.slug || dto.shortName || dto.name)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    const existingSlug = await this.prisma.college.findFirst({
      where: { slug },
    });
    if (existingSlug) {
      throw new ConflictException(`College slug '${slug}' is already taken`);
    }

    const cleanedDomains = Array.from(
      new Set(
        dto.domains
          .map((d) => {
            try {
              return this.domainValidatorService.normalizeDomain(d);
            } catch {
              return null;
            }
          })
          .filter(Boolean) as string[],
      ),
    );

    if (cleanedDomains.length === 0) {
      throw new BadRequestException(
        'At least one valid college domain is required',
      );
    }

    const existingDomain = await this.prisma.collegeDomain.findFirst({
      where: {
        domain: { in: cleanedDomains },
        college: { deletedAt: null },
      },
    });

    if (existingDomain) {
      throw new ConflictException(
        `Domain '${existingDomain.domain}' is already assigned to another active college`,
      );
    }

    let created: any;
    try {
      created = await this.prisma.college.create({
        data: {
          name: dto.name.trim(),
          shortName: dto.shortName?.trim() || null,
          slug,
          city: dto.city?.trim() || null,
          state: dto.state?.trim() || null,
          country: dto.country?.trim() || null,
          logoKey: dto.logoKey || null,
          bannerKey: dto.bannerKey || null,
          isPrivate: dto.isPrivate || false,
          status: 'APPROVED',
          domains: {
            create: cleanedDomains.map((domain, index) => ({
              domain,
              isPrimary: index === 0,
              status: 'ACTIVE',
              isVerified: true,
            })),
          },
        },
        include: {
          domains: true,
        },
      });
    } catch (err) {
      if (dto.logoKey) {
        this.mediaCleanupService
          ?.discardFailedNewUpload(dto.logoKey)
          .catch(() => {});
      }
      if (dto.bannerKey) {
        this.mediaCleanupService
          ?.discardFailedNewUpload(dto.bannerKey)
          .catch(() => {});
      }
      throw err;
    }

    await this.notifyCacheChange();
    return created;
  }

  async updateCollege(
    id: string,
    dto: {
      name?: string;
      shortName?: string;
      slug?: string;
      domains?: string[];
      city?: string;
      state?: string;
      country?: string;
      logoKey?: string;
      bannerKey?: string;
      isPrivate?: boolean;
      isActive?: boolean;
      status?: any;
    },
  ) {
    const existing = await this.prisma.college.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) {
      throw new NotFoundException(`College ${id} not found`);
    }

    const { domains, ...otherDto } = dto;
    const data: any = { ...otherDto };
    if (dto.name) data.name = dto.name.trim();
    if (dto.shortName !== undefined)
      data.shortName = dto.shortName?.trim() || null;

    if (domains && Array.isArray(domains)) {
      const cleanedDomains = Array.from(
        new Set(
          domains
            .map((d) => {
              try {
                return this.domainValidatorService.normalizeDomain(d);
              } catch {
                return null;
              }
            })
            .filter(Boolean) as string[],
        ),
      );

      if (cleanedDomains.length === 0) {
        throw new BadRequestException(
          'At least one valid college domain is required',
        );
      }

      const conflictDomain = await this.prisma.collegeDomain.findFirst({
        where: {
          domain: { in: cleanedDomains },
          collegeId: { not: id },
          college: { deletedAt: null },
        },
      });

      if (conflictDomain) {
        throw new ConflictException(
          `Domain '${conflictDomain.domain}' is already assigned to another active college`,
        );
      }

      await this.deleteSoftDeletedDomains(cleanedDomains, id);

      await this.prisma.collegeDomain.deleteMany({
        where: {
          collegeId: id,
          domain: { notIn: cleanedDomains },
        },
      });

      for (let i = 0; i < cleanedDomains.length; i++) {
        const domain = cleanedDomains[i];
        await this.prisma.collegeDomain.upsert({
          where: { domain },
          create: {
            collegeId: id,
            domain,
            isPrimary: i === 0,
            status: 'ACTIVE',
            isVerified: true,
          },
          update: {
            collegeId: id,
            isPrimary: i === 0,
          },
        });
      }
    }

    let updated: any;
    try {
      updated = await this.prisma.college.update({
        where: { id },
        data,
        include: { domains: true },
      });
    } catch (err) {
      if (dto.logoKey) {
        this.mediaCleanupService
          ?.discardFailedNewUpload(dto.logoKey)
          .catch(() => {});
      }
      if (dto.bannerKey) {
        this.mediaCleanupService
          ?.discardFailedNewUpload(dto.bannerKey)
          .catch(() => {});
      }
      throw err;
    }

    // Colleges are not in the six types this pass targets, but they run the
    // same replacement path — moved onto the shared helper so there is one
    // implementation of the guard rather than a seventh copy of it.
    this.mediaCleanupService?.replaceEntityMedia({
      entityType: 'COLLEGE_LOGO',
      entityId: id,
      previous: existing.logoKey,
      next: updated.logoKey,
      submitted: dto.logoKey !== undefined,
    });

    this.mediaCleanupService?.replaceEntityMedia({
      entityType: 'COLLEGE_BANNER',
      entityId: id,
      previous: existing.bannerKey,
      next: updated.bannerKey,
      submitted: dto.bannerKey !== undefined,
    });

    await this.notifyCacheChange();
    return updated;
  }

  async changeStatus(id: string, status: any) {
    const college = await this.prisma.college.findUnique({ where: { id } });
    if (!college) {
      throw new NotFoundException(`College ${id} not found`);
    }

    const updated = await this.prisma.college.update({
      where: { id },
      data: { status, isActive: status === 'APPROVED' },
    });

    await this.notifyCacheChange();
    return updated;
  }

  async restoreCollege(id: string) {
    const college = await this.prisma.college.findUnique({ where: { id } });
    if (!college) {
      throw new NotFoundException(`College ${id} not found`);
    }

    const restored = await this.prisma.college.update({
      where: { id },
      data: { deletedAt: null, isActive: true, status: 'APPROVED' },
      include: { domains: true },
    });

    await this.notifyCacheChange();
    return restored;
  }

  async addDomain(
    collegeId: string,
    domainStr: string,
    isPrimary: boolean = false,
  ) {
    const domain = this.domainValidatorService.normalizeDomain(domainStr);
    const existing = await this.prisma.collegeDomain.findFirst({
      where: {
        domain,
        college: { deletedAt: null },
      },
    });

    if (existing && existing.collegeId !== collegeId) {
      throw new ConflictException(
        `Domain '${domain}' is already assigned to another active college`,
      );
    }

    await this.deleteSoftDeletedDomains([domain], collegeId);

    if (isPrimary) {
      await this.prisma.collegeDomain.updateMany({
        where: { collegeId },
        data: { isPrimary: false },
      });
    }

    const createdDomain = await this.prisma.collegeDomain.create({
      data: {
        collegeId,
        domain,
        isPrimary,
        status: 'ACTIVE',
        isVerified: true,
      },
    });

    await this.notifyCacheChange();
    return createdDomain;
  }

  async toggleDomainStatus(
    collegeId: string,
    domainId: string,
    status: 'ACTIVE' | 'DISABLED',
  ) {
    const domain = await this.prisma.collegeDomain.findFirst({
      where: { id: domainId, collegeId },
    });

    if (!domain) {
      throw new NotFoundException('Domain record not found');
    }

    const updated = await this.prisma.collegeDomain.update({
      where: { id: domainId },
      data: { status },
    });

    await this.notifyCacheChange();
    return updated;
  }

  async removeDomain(collegeId: string, domainId: string) {
    const domain = await this.prisma.collegeDomain.findFirst({
      where: { id: domainId, collegeId },
    });

    if (!domain) {
      throw new NotFoundException('Domain record not found');
    }

    const totalDomains = await this.prisma.collegeDomain.count({
      where: { collegeId },
    });
    if (totalDomains <= 1) {
      throw new BadRequestException(
        'Cannot delete the last domain of a college',
      );
    }

    await this.prisma.collegeDomain.delete({ where: { id: domainId } });
    await this.notifyCacheChange();
    return { success: true };
  }

  async softDeleteCollege(id: string) {
    const college = await this.prisma.college.findUnique({ where: { id } });
    if (!college) {
      throw new NotFoundException(`College ${id} not found`);
    }

    await this.prisma.college.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false, status: 'DISABLED' },
    });

    await this.notifyCacheChange();
    return { success: true };
  }

  async listCollegeRequests(query: {
    status?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.status) where.status = query.status;

    const [total, requests] = await Promise.all([
      this.prisma.collegeRequest.count({ where }),
      this.prisma.collegeRequest.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      data: requests,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * `CollegeRequest.status` is a plain String column, so nothing below this
   * method constrains what lands in it. Without the checks here an unknown
   * status was written verbatim — leaving a request that matches none of the
   * admin queue's filters and so cannot be found or actioned again — and an
   * unknown id surfaced as a Prisma P2025 escaping as a 500 rather than a 404.
   */
  static readonly COLLEGE_REQUEST_STATUSES = ['PENDING', 'ADDED', 'REJECTED'];

  async updateCollegeRequestStatus(id: string, status: string) {
    const next = String(status || '').toUpperCase();
    if (!AdminCollegesService.COLLEGE_REQUEST_STATUSES.includes(next)) {
      throw new BadRequestException(
        `Invalid status '${status}'. Expected one of: ` +
          AdminCollegesService.COLLEGE_REQUEST_STATUSES.join(', '),
      );
    }

    const existing = await this.prisma.collegeRequest.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException(`College request ${id} not found`);
    }

    return this.prisma.collegeRequest.update({
      where: { id },
      data: { status: next },
    });
  }
}
