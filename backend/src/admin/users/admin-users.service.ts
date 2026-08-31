import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtGuard } from '../../common/guards/jwt.guard';
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

    if (query.search) {
      where.OR = [
        { username: { contains: query.search, mode: 'insensitive' } },
        { displayName: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
        { collegeEmail: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [total, users, statusCounts, verifiedCount] = await Promise.all([
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
          verificationStatus: true,
          createdAt: true,
          college: {
            select: { id: true, name: true },
          },
          // No `_count` here on purpose: post/comment/follower/report counts are
          // five correlated aggregates per row that the admin list never renders.
          // Per-user counts belong to `getUserById`, which is where they are read.
        },
      }),
      // The list header reports Active / Verified / Suspended for the whole
      // filtered set. Deriving those in the client from the current page made
      // them silently wrong from page two onwards (and understated them on
      // page one whenever the set was larger than the page).
      this.prisma.user.groupBy({
        by: ['accountStatus'],
        where,
        _count: { _all: true },
      }),
      this.prisma.user.count({
        where: { ...where, verificationStatus: 'VERIFIED' },
      }),
    ]);

    const byStatus = statusCounts.reduce<Record<string, number>>(
      (acc, row) => ({ ...acc, [row.accountStatus]: row._count._all }),
      {},
    );

    return {
      data: users,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        counts: {
          byStatus,
          active: byStatus.ACTIVE || 0,
          suspendedOrBanned: (byStatus.SUSPENDED || 0) + (byStatus.BANNED || 0),
          verified: verifiedCount,
        },
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

    // The guard caches account status for a few seconds; drop it so the
    // suspension takes hold on the user's very next request rather than
    // whenever that window happens to lapse.
    JwtGuard.clearAccountStatus(id);

    return { success: true, user: updated, reason };
  }

  async unsuspendUser(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    const updated = await this.prisma.user.update({
      where: { id },
      data: { accountStatus: 'ACTIVE' },
    });

    // Lifting a suspension must restore access immediately, not after the
    // status cache expires.
    JwtGuard.clearAccountStatus(id);

    return { success: true, user: updated };
  }

  async softDeleteUser(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    await this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date(), accountStatus: 'DELETED' },
    });

    JwtGuard.clearAccountStatus(id);

    return { success: true };
  }

  async restoreUser(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    await this.prisma.user.update({
      where: { id },
      data: { deletedAt: null, accountStatus: 'ACTIVE' },
    });

    JwtGuard.clearAccountStatus(id);

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
