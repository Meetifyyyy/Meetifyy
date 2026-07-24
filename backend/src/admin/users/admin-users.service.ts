import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SupabaseService } from '../../supabase/supabase.service';

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly supabaseService: SupabaseService,
  ) {}

  async listUsers(query: {
    search?: string;
    accountStatus?: string;
    collegeId?: string;
    emailVerified?: boolean;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: any = {};

    if (query.accountStatus) {
      where.accountStatus = query.accountStatus;
    }

    if (query.collegeId) {
      where.collegeId = query.collegeId;
    }

    if (query.emailVerified !== undefined) {
      where.emailVerified = query.emailVerified;
    }

    if (query.search) {
      where.OR = [
        { username: { contains: query.search, mode: 'insensitive' } },
        { displayName: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
        { collegeEmail: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          username: true,
          displayName: true,
          email: true,
          avatar: true,
          accountStatus: true,
          role: true,
          emailVerified: true,
          createdAt: true,
          college: {
            select: { id: true, name: true },
          },
          _count: {
            select: {
              posts: true,
              comments: true,
              reportsMade: true,
            },
          },
        },
      }),
    ]);

    return {
      data: users,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getUserById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        college: true,
        settings: true,
        notificationPrefs: true,
        _count: {
          select: {
            posts: true,
            comments: true,
            followers: true,
            following: true,
            ownedCommunities: true,
            reportsMade: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return user;
  }

  async suspendUser(id: string, reason?: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    const updated = await this.prisma.user.update({
      where: { id },
      data: { accountStatus: 'SUSPENDED' },
    });

    return { success: true, user: updated, reason };
  }

  async unsuspendUser(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    const updated = await this.prisma.user.update({
      where: { id },
      data: { accountStatus: 'ACTIVE' },
    });

    return { success: true, user: updated };
  }

  async softDeleteUser(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    await this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date(), accountStatus: 'BANNED' },
    });

    return { success: true };
  }

  async restoreUser(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    await this.prisma.user.update({
      where: { id },
      data: { deletedAt: null, accountStatus: 'ACTIVE' },
    });

    return { success: true };
  }

  async verifyEmailManually(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    await this.prisma.user.update({
      where: { id },
      data: { emailVerified: true },
    });

    return { success: true };
  }

  async resetCollegeVerification(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    await this.prisma.user.update({
      where: { id },
      data: { collegeId: null, collegeEmail: null },
    });

    return { success: true };
  }

  async updateCapabilities(id: string, capabilities: { canPost?: boolean; canMessage?: boolean; canActivity?: boolean }) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    const updated = await this.prisma.user.update({
      where: { id },
      data: capabilities,
    });

    return { success: true, user: updated };
  }

  async forceLogout(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    await this.prisma.device.deleteMany({ where: { userId: id } });

    if (this.supabaseService.isConfigured) {
      try {
        await this.supabaseService.client.auth.admin.signOut(id);
      } catch (e) {}
    }

    return { success: true, message: 'User forced logout from all devices' };
  }
}
