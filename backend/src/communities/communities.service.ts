import { Injectable, NotFoundException, ForbiddenException, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventService } from '../events/domain-event.service';
import { RedisService } from '../redis/redis.service';
import Redis from 'ioredis';

@Injectable()
export class CommunitiesService implements OnModuleInit {
  private readonly logger = new Logger('CommunitiesService');
  private redis: Redis | null = null;
  // In-process fallback used only when Redis is unavailable
  private readonly localFallback = new Map<string, { data: any[]; timestamp: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly domainEventService: DomainEventService,
    private readonly redisService: RedisService,
  ) {
    this.redis = this.redisService.getClient();
  }

  async onModuleInit() {
    try {
      await this.prisma.$executeRawUnsafe(`ALTER TYPE "CommunityRole" ADD VALUE IF NOT EXISTS 'OWNER'`).catch(() => {});
      await this.prisma.$executeRawUnsafe(`ALTER TYPE "CommunityRole" ADD VALUE IF NOT EXISTS 'MODERATOR'`).catch(() => {});
      const communities = await this.prisma.community.findMany({
        where: { ownerId: { not: null }, deletedAt: null },
        select: { id: true, ownerId: true }
      });
      for (const comm of communities) {
        if (!comm.ownerId) continue;
        await this.prisma.communityMember.upsert({
          where: { userId_communityId: { userId: comm.ownerId, communityId: comm.id } },
          create: { userId: comm.ownerId, communityId: comm.id, role: 'OWNER' },
          update: { role: 'OWNER' }
        }).catch(() => {});
      }
      this.logger.log(`Repaired owner roles for ${communities.length} communities.`);
      await this.invalidateCommunityCache();
    } catch (e) {
      this.logger.error('Failed to auto-repair community owner roles', e);
    }
  }

  // ── Cache helpers ──────────────────────────────────────────────────────────

  private async getCachedList(key: string): Promise<any[] | null> {
    if (this.redis) {
      try {
        const raw = await this.redis.get(`communities:${key}`);
        if (raw) return JSON.parse(raw);
      } catch { /* fallthrough to local */ }
    }
    const local = this.localFallback.get(key);
    if (local) {
      if (Date.now() - local.timestamp < 60_000) return local.data;
      this.localFallback.delete(key);
    }
    return null;
  }

  private async setCachedList(key: string, data: any[], ttlSeconds = 60): Promise<void> {
    if (this.redis) {
      try {
        await this.redis.set(`communities:${key}`, JSON.stringify(data), 'EX', ttlSeconds);
        return;
      } catch { /* fallthrough to local */ }
    }
    this.localFallback.set(key, { data, timestamp: Date.now() });
  }

  /** Cache a single community detail object. */
  private async getCachedCommunity(id: string): Promise<any | null> {
    if (!this.redis) return null;
    try {
      const raw = await this.redis.get(`community:${id}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  private async setCachedCommunity(id: string, data: any, ttlSeconds = 60): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.set(`community:${id}`, JSON.stringify(data), 'EX', ttlSeconds);
    } catch { /* ignore */ }
  }

  /**
   * Cache a user's collegeId so getCampusCommunities does not need a DB
   * round-trip on every request. TTL: 10 minutes (college affiliation rarely changes).
   */
  private async getCachedCollegeId(userId: string): Promise<string | null> {
    if (!this.redis) return null;
    try {
      const val = await this.redis.get(`user:collegeId:${userId}`);
      return val || null;
    } catch {
      return null;
    }
  }

  private async setCachedCollegeId(userId: string, collegeId: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.set(`user:collegeId:${userId}`, collegeId, 'EX', 10 * 60);
    } catch { /* ignore */ }
  }

  /**
   * Targeted cache invalidation — delete only the keys we know are stale.
   * Avoids the expensive SCAN + DEL loop that was blowing the entire cache
   * on every join/leave/create/update and causing sustained cache misses.
   *
   * @param communityId  The community that changed (invalidates its detail key).
   * @param collegeId    If provided, also invalidates that college's campus list.
   */
  private async invalidateCommunityCache(communityId?: string, collegeId?: string): Promise<void> {
    const keysToDelete: string[] = [
      // List cache — all paginations of the global list
      'communities:all:30:0',
      'communities:all:20:0',
      'communities:all:50:0',
    ];

    if (communityId) {
      keysToDelete.push(`community:${communityId}`);
    }

    if (collegeId) {
      // Invalidate first-page campus list for this college (common page sizes)
      keysToDelete.push(
        `communities:campus:${collegeId}:30:0`,
        `communities:campus:${collegeId}:20:0`,
        `communities:campus:${collegeId}:50:0`,
      );
    }

    if (this.redis) {
      try {
        await this.redis.del(...keysToDelete);
      } catch { /* ignore */ }
    }
    // Always clear local fallback map regardless of Redis availability
    this.localFallback.clear();
  }

  async getAllCommunities(userId?: string, limit = 30, offset = 0) {
    const cacheKey = `all:${limit}:${offset}`;
    let communities = await this.getCachedList(cacheKey);
    if (!communities) {
      communities = await this.prisma.community.findMany({
        where: { deletedAt: null, isCampusCommunity: false },
        orderBy: { memberCount: 'desc' },
        take: limit,
        skip: offset,
      });
      await this.setCachedList(cacheKey, communities, 60);
    }

    if (!userId || communities.length === 0) {
      return communities.map(c => ({
        ...c,
        isJoined: false,
        userRole: null,
      }));
    }

    const userMemberships = await this.prisma.communityMember.findMany({
      where: { userId, communityId: { in: communities.map(c => c.id) } },
      select: { communityId: true, role: true },
    });

    const membershipMap = new Map(userMemberships.map(m => [m.communityId, m.role]));

    return communities.map(c => {
      const isOwner = Boolean(c.ownerId && c.ownerId === userId);
      const isMember = membershipMap.has(c.id);
      return {
        ...c,
        isJoined: isMember || isOwner,
        userRole: isOwner ? 'OWNER' : (membershipMap.get(c.id) || null),
      };
    });
  }

  async getCampusCommunities(userId: string, limit = 30, offset = 0) {
    if (!userId) return [];

    // Try Redis first — avoids a DB round-trip for the collegeId lookup
    let collegeId = await this.getCachedCollegeId(userId);
    if (!collegeId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { collegeId: true },
      });
      if (!user?.collegeId) return [];
      collegeId = user.collegeId;
      await this.setCachedCollegeId(userId, collegeId);
    }
    const cacheKey = `campus:${collegeId}:${limit}:${offset}`;
    let communities = await this.getCachedList(cacheKey);
    if (!communities) {
      communities = await this.prisma.community.findMany({
        where: { deletedAt: null, isCampusCommunity: true, collegeId },
        orderBy: { memberCount: 'desc' },
        take: limit,
        skip: offset,
      });
      await this.setCachedList(cacheKey, communities, 120);
    }

    if (communities.length === 0) return [];

    const userMemberships = await this.prisma.communityMember.findMany({
      where: { userId, communityId: { in: communities.map(c => c.id) } },
      select: { communityId: true, role: true },
    });

    const membershipMap = new Map(userMemberships.map(m => [m.communityId, m.role]));

    return communities.map(c => {
      const isOwner = Boolean(c.ownerId && c.ownerId === userId);
      const isMember = membershipMap.has(c.id);
      return {
        ...c,
        isJoined: isMember || isOwner,
        userRole: isOwner ? 'OWNER' : (membershipMap.get(c.id) || null),
      };
    });
  }

  async getCommunityById(id: string, userId?: string) {
    const t0 = Date.now();

    // Check Redis first for a cached detail response
    let community = await this.getCachedCommunity(id);
    if (!community) {
      community = await this.prisma.community.findUnique({
        where: { id },
        include: {
          owner: {
            select: { id: true, username: true, displayName: true, avatar: true },
          },
          college: {
            select: { id: true, name: true, shortName: true },
          },
          members: {
            take: 50,
            orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                  displayName: true,
                  avatar: true,
                },
              },
            },
          },
          _count: {
            select: { members: true, posts: true },
          },
        },
      });

      if (!community) {
        throw new NotFoundException('COMMUNITY_NOT_FOUND');
      }

      if (community.deletedAt) {
        throw new NotFoundException('COMMUNITY_DELETED');
      }

      const baseForCache = { ...community };
      await this.setCachedCommunity(id, baseForCache, 60);
    }

    if (
      community.ownerId &&
      community.owner &&
      !community.members.some((m: any) => m.userId === community.ownerId)
    ) {
      community.members.unshift({
        userId: community.owner.id,
        communityId: community.id,
        joinedAt: community.createdAt,
        role: 'OWNER' as any,
        user: community.owner,
      } as any);
    }

    if (community.members) {
      community.members.forEach((m: any) => {
        if (community.ownerId && m.userId === community.ownerId) {
          m.role = 'OWNER';
        }
      });
    }

    const isOwner = Boolean(userId && community.ownerId && community.ownerId === userId);
    const currentMember = userId
      ? community.members.find((m: any) => m.userId === userId)
      : null;
    const isJoined = !!currentMember || isOwner;
    const userRole = isOwner ? 'OWNER' : (currentMember?.role || null);

    // Eligibility check for Campus communities
    let isEligibleToJoin = true;
    let eligibilityMessage: string | null = null;

    if (community.isCampusCommunity && community.collegeId) {
      let requestingUserCollegeId: string | null = null;
      if (userId) {
        requestingUserCollegeId = await this.getCachedCollegeId(userId);
        if (!requestingUserCollegeId) {
          const userRec = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { collegeId: true },
          });
          requestingUserCollegeId = userRec?.collegeId || null;
          if (requestingUserCollegeId) {
            await this.setCachedCollegeId(userId, requestingUserCollegeId);
          }
        }
      }

      if (!requestingUserCollegeId || requestingUserCollegeId !== community.collegeId) {
        isEligibleToJoin = false;
        const collegeName = community.college?.name || 'this college';
        eligibilityMessage = `You're not eligible to join this community. This community is limited to verified students of ${collegeName}.`;
      }
    }

    // Pending join request check for Private communities
    let hasPendingRequest = false;
    if (userId && community.isPrivate && !isJoined) {
      const pendingReq = await this.prisma.communityJoinRequest.findUnique({
        where: { communityId_userId: { communityId: id, userId } },
      });
      hasPendingRequest = pendingReq?.status === 'PENDING';
    }

    const canViewPosts = isJoined || (!community.isPrivate && isEligibleToJoin);

    return {
      ...community,
      isJoined,
      userRole,
      isEligibleToJoin,
      eligibilityMessage,
      canViewPosts,
      hasPendingRequest,
    };
  }

  async joinCommunity(communityId: string, userId: string) {
    const community = await this.prisma.community.findUnique({
      where: { id: communityId },
      include: { college: { select: { name: true } } },
    });
    if (!community || community.deletedAt) throw new NotFoundException('Community not found');

    // 1. Campus Eligibility Check
    if (community.isCampusCommunity && community.collegeId) {
      let userCollegeId = await this.getCachedCollegeId(userId);
      if (!userCollegeId) {
        const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { collegeId: true } });
        userCollegeId = u?.collegeId || null;
      }
      if (!userCollegeId || userCollegeId !== community.collegeId) {
        const collegeName = community.college?.name || 'this college';
        throw new ForbiddenException(
          `You're not eligible to join this community. This community is limited to verified students of ${collegeName}.`
        );
      }
    }

    // 2. Private Community Join Request Workflow
    if (community.isPrivate) {
      const existingMember = await this.prisma.communityMember.findUnique({
        where: { userId_communityId: { userId, communityId } },
      });
      if (existingMember) return { success: true, status: 'MEMBER', isJoined: true };

      await this.prisma.communityJoinRequest.upsert({
        where: { communityId_userId: { communityId, userId } },
        create: { communityId, userId, status: 'PENDING' },
        update: { status: 'PENDING' },
      });

      if (community.ownerId) {
        this.domainEventService.emit('community.joinRequested', { communityId, userId, ownerId: community.ownerId });
      }

      return {
        success: true,
        status: 'PENDING',
        hasPendingRequest: true,
        message: 'Join request submitted to moderators.',
      };
    }

    // 3. Public or Campus Community -> Direct Instant Join
    const lockKey = `toggle:join:${userId}:${communityId}`;

    return this.redisService.withLock(lockKey, 2000, async () => {
      let newCount = community.memberCount;
      const joined = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.communityMember.findUnique({
          where: { userId_communityId: { userId, communityId } },
        });
        if (existing) return false;

        await tx.communityMember.create({
          data: { userId, communityId, role: 'MEMBER' },
        });
        const updated = await tx.community.update({
          where: { id: communityId },
          data: { memberCount: { increment: 1 } },
          select: { memberCount: true },
        });
        newCount = updated.memberCount;
        return true;
      });

      if (joined) {
        this.domainEventService.emit('community.memberJoined', { communityId, userId, memberCount: newCount });
        await this.invalidateCommunityCache(communityId, community.collegeId ?? undefined);
      }

      return { success: true, status: 'MEMBER', isJoined: true };
    });
  }

  async getPendingRequests(communityId: string, requestingUserId: string) {
    const member = await this.prisma.communityMember.findUnique({
      where: { userId_communityId: { userId: requestingUserId, communityId } },
    });
    const community = await this.prisma.community.findUnique({
      where: { id: communityId },
      select: { ownerId: true },
    });

    const isOwnerOrMod =
      community?.ownerId === requestingUserId || member?.role === 'OWNER' || member?.role === 'MODERATOR';
    if (!isOwnerOrMod) {
      throw new ForbiddenException('Only community owners or moderators can view join requests');
    }

    return this.prisma.communityJoinRequest.findMany({
      where: { communityId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatar: true,
          },
        },
      },
    });
  }

  async acceptJoinRequest(communityId: string, requestId: string, requestingUserId: string) {
    const member = await this.prisma.communityMember.findUnique({
      where: { userId_communityId: { userId: requestingUserId, communityId } },
    });
    const community = await this.prisma.community.findUnique({
      where: { id: communityId },
      select: { ownerId: true, collegeId: true },
    });

    const isOwnerOrMod =
      community?.ownerId === requestingUserId || member?.role === 'OWNER' || member?.role === 'MODERATOR';
    if (!isOwnerOrMod) {
      throw new ForbiddenException('Only community owners or moderators can manage join requests');
    }

    const joinReq = await this.prisma.communityJoinRequest.findUnique({ where: { id: requestId } });
    if (!joinReq || joinReq.communityId !== communityId) {
      throw new NotFoundException('Join request not found');
    }

    let newMemberCount = 0;
    await this.prisma.$transaction(async (tx) => {
      await tx.communityJoinRequest.update({
        where: { id: requestId },
        data: { status: 'ACCEPTED' },
      });
      await tx.communityMember.upsert({
        where: { userId_communityId: { userId: joinReq.userId, communityId } },
        create: { userId: joinReq.userId, communityId, role: 'MEMBER' },
        update: {},
      });
      const updated = await tx.community.update({
        where: { id: communityId },
        data: { memberCount: { increment: 1 } },
        select: { memberCount: true },
      });
      newMemberCount = updated.memberCount;
    });

    await this.invalidateCommunityCache(communityId, community?.collegeId ?? undefined);
    this.domainEventService.emit('community.requestAccepted', {
      communityId,
      userId: joinReq.userId,
      memberCount: newMemberCount,
    });
    return { success: true };
  }

  async declineJoinRequest(communityId: string, requestId: string, requestingUserId: string) {
    const member = await this.prisma.communityMember.findUnique({
      where: { userId_communityId: { userId: requestingUserId, communityId } },
    });
    const community = await this.prisma.community.findUnique({
      where: { id: communityId },
      select: { ownerId: true },
    });

    const isOwnerOrMod =
      community?.ownerId === requestingUserId || member?.role === 'OWNER' || member?.role === 'MODERATOR';
    if (!isOwnerOrMod) {
      throw new ForbiddenException('Only community owners or moderators can manage join requests');
    }

    const joinReq = await this.prisma.communityJoinRequest.findUnique({ where: { id: requestId } });
    if (!joinReq || joinReq.communityId !== communityId) {
      throw new NotFoundException('Join request not found');
    }

    await this.prisma.communityJoinRequest.update({
      where: { id: requestId },
      data: { status: 'DECLINED' },
    });

    this.domainEventService.emit('community.requestDeclined', { communityId, userId: joinReq.userId });
    return { success: true };
  }

  async leaveCommunity(communityId: string, userId: string) {
    const community = await this.prisma.community.findUnique({ where: { id: communityId } });
    if (!community || community.deletedAt) throw new NotFoundException('Community not found');

    if (community.ownerId === userId) {
      throw new ForbiddenException('Community owner cannot leave without transferring ownership');
    }

    const lockKey = `toggle:join:${userId}:${communityId}`;

    return this.redisService.withLock(lockKey, 2000, async () => {
      let newCount = community.memberCount;
      const left = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.communityMember.findUnique({
          where: { userId_communityId: { userId, communityId } }
        });
        if (!existing) return false;

        await tx.communityMember.delete({
          where: { userId_communityId: { userId, communityId } }
        });
        const updated = await tx.community.update({
          where: { id: communityId },
          data: { memberCount: { decrement: 1 } },
          select: { memberCount: true }
        });
        newCount = Math.max(0, updated.memberCount);
        return true;
      });

      if (left) {
        this.domainEventService.emit('community.memberLeft', { communityId, userId, memberCount: newCount });
        await this.invalidateCommunityCache(communityId, community.collegeId ?? undefined);
      }

      return { success: true };
    });
  }

  async createCommunity(data: any, creatorId: string) {
    const rawSlug = (data.name || 'community').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const slug = rawSlug || `community-${Date.now()}`;
    const existing = await this.prisma.community.findUnique({ where: { slug } });
    const finalSlug = existing ? `${slug}-${Date.now()}` : slug;

    const avatarVal = data.avatarKey || data.avatar;
    const coverVal = data.coverKey || data.coverImage;
    const descVal = data.description || data.desc;

    const createData: any = {
      name: data.name,
      description: descVal,
      avatarKey: avatarVal,
      coverKey: coverVal,
      slug: finalSlug,
      memberCount: 1,
      owner: { connect: { id: creatorId } },
      isPrivate: data.isPrivate !== undefined ? Boolean(data.isPrivate) : (data.privacy === 'private'),
      members: {
        create: [{ userId: creatorId, role: 'OWNER' }]
      }
    };

    if (data.isCampusCommunity || data.privacy === 'campus') {
      const user = await this.prisma.user.findUnique({ where: { id: creatorId }, select: { collegeId: true } });
      if (user?.collegeId) {
        createData.isCampusCommunity = true;
        createData.college = { connect: { id: user.collegeId } };
      }
    }

    if (avatarVal && typeof avatarVal === 'string') {
      if (avatarVal.startsWith('/api/media/')) {
        createData.avatarMedia = { connect: { objectKey: avatarVal.replace('/api/media/', '') } };
      } else if (avatarVal.startsWith('http')) {
        createData.avatarMedia = { create: { provider: 'external', bucket: 'external', objectKey: avatarVal, mimeType: 'image/jpeg', fileSize: 0, ownerId: creatorId } };
      }
    }

    if (coverVal && typeof coverVal === 'string') {
      if (coverVal.startsWith('/api/media/')) {
        createData.coverMedia = { connect: { objectKey: coverVal.replace('/api/media/', '') } };
      } else if (coverVal.startsWith('http')) {
        createData.coverMedia = { create: { provider: 'external', bucket: 'external', objectKey: coverVal, mimeType: 'image/jpeg', fileSize: 0, ownerId: creatorId } };
      }
    }

    const created = await this.prisma.community.create({
      data: createData,
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                displayName: true,
                avatar: true,
              },
            },
          },
        },
        _count: {
          select: { members: true, posts: true },
        },
      },
    });
    this.domainEventService.emit('community.created', { communityId: created.id, creatorId, community: created });
    await this.invalidateCommunityCache(created.id);
    return created;
  }

  async updateCommunity(communityId: string, data: any, requestingUserId: string) {
    const community = await this.prisma.community.findUnique({
      where: { id: communityId },
      select: { ownerId: true }
    });
    if (!community) throw new NotFoundException('Community not found');

    const member = await this.prisma.communityMember.findUnique({
      where: { userId_communityId: { userId: requestingUserId, communityId } },
    });

    const isOwner = community.ownerId === requestingUserId || member?.role === 'OWNER';

    if (!isOwner) {
      throw new ForbiddenException('Only the community owner can update community info');
    }

    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name;
    const descriptionInput = data.description !== undefined ? data.description : data.desc;
    if (descriptionInput !== undefined) updateData.description = descriptionInput;

    if (data.isPrivate !== undefined) {
      updateData.isPrivate = Boolean(data.isPrivate);
    } else if (data.privacy !== undefined) {
      updateData.isPrivate = data.privacy === 'private';
    }
    
    const avatarInput = data.avatarKey !== undefined ? data.avatarKey : data.avatar;
    if (avatarInput !== undefined) {
      updateData.avatarKey = avatarInput;
      if (avatarInput && typeof avatarInput === 'string') {
        if (avatarInput.startsWith('/api/media/')) {
          updateData.avatarMedia = { connect: { objectKey: avatarInput.replace('/api/media/', '') } };
        } else if (avatarInput.startsWith('http')) {
          updateData.avatarMedia = { create: { provider: 'external', bucket: 'external', objectKey: avatarInput, mimeType: 'image/jpeg', fileSize: 0, ownerId: requestingUserId } };
        }
      }
    }

    const coverInput = data.coverKey !== undefined ? data.coverKey : data.coverImage;
    if (coverInput !== undefined) {
      updateData.coverKey = coverInput;
      if (coverInput && typeof coverInput === 'string') {
        if (coverInput.startsWith('/api/media/')) {
          updateData.coverMedia = { connect: { objectKey: coverInput.replace('/api/media/', '') } };
        } else if (coverInput.startsWith('http')) {
          updateData.coverMedia = { create: { provider: 'external', bucket: 'external', objectKey: coverInput, mimeType: 'image/jpeg', fileSize: 0, ownerId: requestingUserId } };
        }
      }
    }

    const updated = await this.prisma.community.update({
      where: { id: communityId },
      data: updateData
    });
    this.domainEventService.emit('community.updated', { communityId, community: updated });
    await this.invalidateCommunityCache(communityId);
    return updated;
  }

  async updateMemberRole(communityId: string, memberId: string, newRole: 'MODERATOR' | 'MEMBER', requestingUserId: string) {
    const community = await this.prisma.community.findUnique({
      where: { id: communityId },
      select: { ownerId: true }
    });
    if (!community) throw new NotFoundException('Community not found');

    const requesterMember = await this.prisma.communityMember.findUnique({
      where: { userId_communityId: { userId: requestingUserId, communityId } },
    });

    const isOwner = community.ownerId === requestingUserId || requesterMember?.role === 'OWNER';
    if (!isOwner) {
      throw new ForbiddenException('Only the community owner can manage member roles');
    }

    if (memberId === community.ownerId) {
      throw new ForbiddenException('Cannot modify the role of the community owner');
    }

    const targetMember = await this.prisma.communityMember.findUnique({
      where: { userId_communityId: { userId: memberId, communityId } },
    });
    if (!targetMember) throw new NotFoundException('Member not found in community');

    const updated = await this.prisma.communityMember.update({
      where: { userId_communityId: { userId: memberId, communityId } },
      data: { role: newRole as any },
    });

    this.domainEventService.emit('community.roleUpdated', { communityId, memberId, newRole });
    await this.invalidateCommunityCache(communityId);
    return updated;
  }

  async removeMember(communityId: string, memberId: string, requestingUserId: string) {
    const community = await this.prisma.community.findUnique({
      where: { id: communityId },
      select: { ownerId: true }
    });
    if (!community) throw new NotFoundException('Community not found');

    const requester = await this.prisma.communityMember.findUnique({
      where: { userId_communityId: { userId: requestingUserId, communityId } },
    });

    const isOwner = community.ownerId === requestingUserId || requester?.role === 'OWNER';
    const isMod = requester?.role === 'MODERATOR';

    if (!isOwner && !isMod) {
      throw new ForbiddenException('Only the owner or moderators can remove members');
    }

    const memberToRemove = await this.prisma.communityMember.findUnique({
      where: { userId_communityId: { userId: memberId, communityId } },
    });
    if (!memberToRemove) throw new NotFoundException('Member not found');

    if (memberId === community.ownerId || memberToRemove.role === 'OWNER') {
      throw new ForbiddenException('Cannot remove the community owner');
    }

    if (isMod && memberToRemove.role === 'MODERATOR') {
      throw new ForbiddenException('Moderators cannot remove other moderators');
    }

    let newCount = 0;
    await this.prisma.$transaction(async (tx) => {
      await tx.communityMember.delete({
        where: { userId_communityId: { userId: memberId, communityId } },
      });
      const updated = await tx.community.update({
        where: { id: communityId },
        data: { memberCount: { decrement: 1 } },
        select: { memberCount: true }
      });
      newCount = Math.max(0, updated.memberCount);
    });

    this.domainEventService.emit('community.memberLeft', { communityId, userId: memberId, memberCount: newCount });
    await this.invalidateCommunityCache(communityId);

    return { success: true };
  }

  async deleteCommunity(communityId: string, requestingUserId: string) {
    const community = await this.prisma.community.findUnique({
      where: { id: communityId },
    });

    if (!community || community.deletedAt) {
      throw new NotFoundException('COMMUNITY_NOT_FOUND');
    }

    const member = await this.prisma.communityMember.findUnique({
      where: { userId_communityId: { userId: requestingUserId, communityId } },
    });

    const isOwner = community.ownerId === requestingUserId || member?.role === 'OWNER';

    if (!isOwner) {
      throw new ForbiddenException('Only the community owner can delete this community');
    }

    const now = new Date();

    // 1. Find all post IDs associated with this community
    const communityPosts = await this.prisma.post.findMany({
      where: { communityId },
      select: { id: true },
    });
    const postIds = communityPosts.map((p) => p.id);

    await this.prisma.$transaction(async (tx) => {
      // ✅ 1. Soft-delete the community record
      await tx.community.update({
        where: { id: communityId },
        data: { deletedAt: now, memberCount: 0 },
      });

      if (postIds.length > 0) {
        // ✅ 2. Soft-delete all community posts
        await tx.post.updateMany({
          where: { id: { in: postIds } },
          data: { deletedAt: now },
        });

        // ✅ 3. Soft-delete all comments on community posts
        await tx.comment.updateMany({
          where: { postId: { in: postIds } },
          data: { deletedAt: now, isDeleted: true },
        });

        // ✅ 4. Clean up likes, bookmarks, shares, hashtags, mentions, poll votes for those posts
        await tx.postLike.deleteMany({
          where: { postId: { in: postIds } },
        });

        await tx.postBookmark.deleteMany({
          where: { postId: { in: postIds } },
        });

        await tx.postShare.deleteMany({
          where: { postId: { in: postIds } },
        });

        await tx.postHashtag.deleteMany({
          where: { postId: { in: postIds } },
        });

        await tx.mention.deleteMany({
          where: { sourceId: { in: postIds } },
        });

        await tx.pollVote.deleteMany({
          where: { postId: { in: postIds } },
        });

        await tx.pollOption.deleteMany({
          where: { postId: { in: postIds } },
        });

        // ✅ 5. Clean up notifications related to these posts
        await tx.notification.deleteMany({
          where: { entityId: { in: postIds } },
        });
      }

      // ✅ 6. Resolve reports related to community or its posts
      await tx.report.updateMany({
        where: {
          targetId: { in: [communityId, ...postIds] },
        },
        data: { status: 'RESOLVED', actionTaken: 'Community deleted' },
      });

      // ✅ 7. Remove all community membership records
      await tx.communityMember.deleteMany({
        where: { communityId },
      });
    });

    // ✅ 8. Invalidate all relevant Redis & local memory caches
    await this.invalidateCommunityCache(communityId, community.collegeId ?? undefined);

    const redis = this.redisService.getClient();
    if (redis) {
      try {
        const postKeys = await redis.keys('posts:*');
        const feedKeys = await redis.keys('feed:*');
        const allKeys = [...postKeys, ...feedKeys, `community-posts:${communityId}`];
        if (allKeys.length > 0) {
          await redis.del(...allKeys);
        }
      } catch (err) {
        this.logger.warn(`Failed clearing Redis post keys for community ${communityId}: ${err?.message}`);
      }
    }

    // ✅ 9. Emit real-time domain event so WebSockets notify all clients immediately
    this.domainEventService.emit('community.deleted', {
      communityId,
      deletedAt: now.toISOString(),
    });

    return { success: true, communityId };
  }
}
