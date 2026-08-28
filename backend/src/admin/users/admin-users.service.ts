import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
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
              followers: true,
              following: true,
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
      data: { deletedAt: new Date(), accountStatus: 'DELETED' },
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

  async updateCapabilities(
    id: string,
    capabilities: {
      canPost?: boolean;
      canMessage?: boolean;
      canActivity?: boolean;
    },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    const updated = await this.prisma.user.update({
      where: { id },
      data: capabilities,
    });

    return { success: true, user: updated };
  }

  /**
   * Assign or revoke the Campus Representative role. This is the ONLY write path
   * for `isCampusRep` in the entire system — no /api/* user-facing endpoint ever
   * accepts this field, so the role is immutable from normal user flows.
   */
  async setCampusRep(id: string, isCampusRep: boolean) {
    const repSelect = {
      id: true,
      username: true,
      displayName: true,
      avatar: true,
      isCampusRep: true,
      college: { select: { id: true, name: true } },
    } as const;

    // Run the invariant check + write in one transaction so two concurrent
    // assignments can't both slip a second rep onto the same campus.
    const updated = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id },
        select: { id: true, collegeId: true, isCampusRep: true },
      });
      if (!user) throw new NotFoundException('User not found');

      if (isCampusRep) {
        // A representative must belong to a campus (their event scope).
        if (!user.collegeId) {
          throw new BadRequestException(
            'User has no verified campus. Cannot assign Campus Representative.',
          );
        }
        // Enforce exactly one representative per campus.
        if (!user.isCampusRep) {
          const existing = await tx.user.findFirst({
            where: {
              collegeId: user.collegeId,
              isCampusRep: true,
              deletedAt: null,
              NOT: { id },
            },
            select: { username: true, displayName: true },
          });
          if (existing) {
            throw new ConflictException(
              `This campus already has a representative (@${existing.username}). Revoke them first.`,
            );
          }
        }
      }

      return tx.user.update({
        where: { id },
        data: { isCampusRep },
        select: repSelect,
      });
    });

    return { success: true, user: updated };
  }

  /**
   * Lightweight, fast search for users who could be made a Campus Representative.
   * Returns only the fields the assignment UI needs (no per-user _count
   * subqueries), so it stays fast. Includes `isCampusRep` so the UI can render
   * the correct Assign/Revoke state.
   */
  async searchRepCandidates(search?: string, collegeId?: string) {
    const term = (search || '').trim();
    if (!term) return { data: [] };

    const where: any = {
      deletedAt: null,
      OR: [
        { username: { contains: term, mode: 'insensitive' } },
        { displayName: { contains: term, mode: 'insensitive' } },
        { email: { contains: term, mode: 'insensitive' } },
      ],
    };
    if (collegeId) where.collegeId = collegeId;

    const users = await this.prisma.user.findMany({
      where,
      take: 20,
      orderBy: { displayName: 'asc' },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatar: true,
        isCampusRep: true,
        college: { select: { id: true, name: true } },
      },
    });

    return { data: users };
  }

  /**
   * List all active Campus Representatives, optionally filtered by campus.
   */
  async listCampusReps(collegeId?: string) {
    const where: any = { isCampusRep: true, deletedAt: null };
    if (collegeId) where.collegeId = collegeId;

    const reps = await this.prisma.user.findMany({
      where,
      orderBy: { displayName: 'asc' },
      select: {
        id: true,
        username: true,
        displayName: true,
        email: true,
        avatar: true,
        isCampusRep: true,
        createdAt: true,
        college: { select: { id: true, name: true } },
      },
    });

    return { data: reps, meta: { total: reps.length } };
  }

  async forceLogout(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    if (this.supabaseService.isConfigured) {
      try {
        await this.supabaseService.client.auth.admin.signOut(id);
      } catch (e) {}
    }

    return { success: true, message: 'User forced logout' };
  }
}
