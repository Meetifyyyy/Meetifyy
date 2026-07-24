import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AdminCollegesService {
  constructor(private readonly prisma: PrismaService) {}

  async listColleges(query: {
    search?: string;
    status?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: any = {
      deletedAt: null,
    };

    if (query.status) {
      where.status = query.status;
    }

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { shortName: { contains: query.search, mode: 'insensitive' } },
        { city: { contains: query.search, mode: 'insensitive' } },
        { domains: { some: { domain: { contains: query.search, mode: 'insensitive' } } } },
      ];
    }

    const [total, colleges] = await Promise.all([
      this.prisma.college.count({ where }),
      this.prisma.college.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
        include: {
          domains: true,
          _count: {
            select: { users: true },
          },
        },
      }),
    ]);

    return {
      data: colleges,
      meta: {
        total,
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
        domains: true,
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
    // Generate slug if not provided
    const slug = (dto.slug || dto.shortName || dto.name)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    // Check slug uniqueness
    const existingSlug = await this.prisma.college.findFirst({ where: { slug } });
    if (existingSlug) {
      throw new ConflictException(`College slug '${slug}' is already taken`);
    }

    // Check domain uniqueness
    const cleanedDomains = Array.from(
      new Set(dto.domains.map((d) => d.toLowerCase().trim()).filter(Boolean)),
    );

    if (cleanedDomains.length === 0) {
      throw new BadRequestException('At least one college domain is required');
    }

    const existingDomain = await this.prisma.collegeDomain.findFirst({
      where: { domain: { in: cleanedDomains } },
    });

    if (existingDomain) {
      throw new ConflictException(`Domain '${existingDomain.domain}' is already assigned to another college`);
    }

    return this.prisma.college.create({
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
          })),
        },
      },
      include: {
        domains: true,
      },
    });
  }

  async updateCollege(id: string, dto: {
    name?: string;
    shortName?: string;
    slug?: string;
    city?: string;
    state?: string;
    country?: string;
    logoKey?: string;
    bannerKey?: string;
    isPrivate?: boolean;
    isActive?: boolean;
    status?: any;
  }) {
    const existing = await this.prisma.college.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) {
      throw new NotFoundException(`College ${id} not found`);
    }

    const data: any = { ...dto };
    if (dto.name) data.name = dto.name.trim();
    if (dto.shortName !== undefined) data.shortName = dto.shortName?.trim() || null;

    return this.prisma.college.update({
      where: { id },
      data,
      include: { domains: true },
    });
  }

  async changeStatus(id: string, status: any) {
    const college = await this.prisma.college.findUnique({ where: { id } });
    if (!college || college.deletedAt) {
      throw new NotFoundException(`College ${id} not found`);
    }

    return this.prisma.college.update({
      where: { id },
      data: { status, isActive: status === 'APPROVED' },
    });
  }

  async addDomain(collegeId: string, domainStr: string, isPrimary: boolean = false) {
    const domain = domainStr.toLowerCase().trim();
    const existing = await this.prisma.collegeDomain.findUnique({ where: { domain } });

    if (existing) {
      throw new ConflictException(`Domain '${domain}' is already assigned`);
    }

    if (isPrimary) {
      await this.prisma.collegeDomain.updateMany({
        where: { collegeId },
        data: { isPrimary: false },
      });
    }

    return this.prisma.collegeDomain.create({
      data: {
        collegeId,
        domain,
        isPrimary,
      },
    });
  }

  async removeDomain(collegeId: string, domainId: string) {
    const domain = await this.prisma.collegeDomain.findFirst({
      where: { id: domainId, collegeId },
    });

    if (!domain) {
      throw new NotFoundException('Domain record not found');
    }

    const totalDomains = await this.prisma.collegeDomain.count({ where: { collegeId } });
    if (totalDomains <= 1) {
      throw new BadRequestException('Cannot delete the last domain of a college');
    }

    await this.prisma.collegeDomain.delete({ where: { id: domainId } });
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

    return { success: true };
  }
}
