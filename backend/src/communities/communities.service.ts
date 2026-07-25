import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CommunitiesService {
  private communitiesCache = new Map<string, { data: any[]; timestamp: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async getAllCommunities(userId?: string, limit = 30, offset = 0) {
    const cacheKey = `all:${limit}:${offset}`;
    let communities;
    const cached = this.communitiesCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 60000) {
      communities = cached.data;
    } else {
      communities = await this.prisma.community.findMany({
        where: { deletedAt: null },
        orderBy: { memberCount: 'desc' },
        take: limit,
        skip: offset,
      });
      this.communitiesCache.set(cacheKey, { data: communities, timestamp: Date.now() });
    }

    if (!userId || communities.length === 0) {
      return communities.map(c => ({ ...c, isJoined: false, userRole: null }));
    }

    const userMemberships = await this.prisma.communityMember.findMany({
      where: { userId, communityId: { in: communities.map(c => c.id) } },
      select: { communityId: true, role: true },
    });

    const membershipMap = new Map(userMemberships.map(m => [m.communityId, m.role]));

    return communities.map(c => ({
      ...c,
      isJoined: membershipMap.has(c.id),
      userRole: membershipMap.get(c.id) || null,
    }));
  }

  async getCampusCommunities(userId: string, limit = 30, offset = 0) {
    if (!userId) return [];
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { collegeId: true } });
    if (!user?.collegeId) return [];
    const cacheKey = `campus:${user.collegeId}:${limit}:${offset}`;
    let communities;
    const cached = this.communitiesCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 60000) {
      communities = cached.data;
    } else {
      communities = await this.prisma.community.findMany({
        where: { deletedAt: null, isCampusCommunity: true, collegeId: user.collegeId },
        orderBy: { memberCount: 'desc' },
        take: limit,
        skip: offset,
      });
      this.communitiesCache.set(cacheKey, { data: communities, timestamp: Date.now() });
    }

    if (communities.length === 0) return [];

    const userMemberships = await this.prisma.communityMember.findMany({
      where: { userId, communityId: { in: communities.map(c => c.id) } },
      select: { communityId: true, role: true },
    });

    const membershipMap = new Map(userMemberships.map(m => [m.communityId, m.role]));

    return communities.map(c => ({
      ...c,
      isJoined: membershipMap.has(c.id),
      userRole: membershipMap.get(c.id) || null,
    }));
  }

  async getCommunityById(id: string, userId?: string) {
    const community = await this.prisma.community.findUnique({
      where: { id },
      include: {
        members: {
          include: { 
            user: {
              select: {
                id: true,
                username: true,
                displayName: true,
                avatar: true
              }
            }
          },
        },
        _count: {
          select: { members: true, posts: true },
        },
      },
    });

    if (!community) {
      throw new NotFoundException('Community not found');
    }

    if (community.members) {
      const getCommunityRoleRank = (m: any) => {
        if ((community.ownerId && m.userId === community.ownerId) || (m as any).role === 'OWNER') return 0;
        if (m.role === 'ADMIN') return 1;
        if (m.role === 'MODERATOR') return 2;
        return 3;
      };

      community.members.sort((a, b) => {
        const rankA = getCommunityRoleRank(a);
        const rankB = getCommunityRoleRank(b);
        if (rankA !== rankB) return rankA - rankB;
        const timeA = a.joinedAt ? new Date(a.joinedAt).getTime() : 0;
        const timeB = b.joinedAt ? new Date(b.joinedAt).getTime() : 0;
        return timeA - timeB;
      });
    }

    const currentMember = userId ? community.members.find(m => m.userId === userId) : null;

    return {
      ...community,
      isJoined: !!currentMember,
      userRole: currentMember?.role || null,
    };

  }

  async joinCommunity(communityId: string, userId: string) {
    const community = await this.prisma.community.findUnique({ where: { id: communityId } });
    if (!community) throw new NotFoundException('Community not found');

    const existingMember = await this.prisma.communityMember.findUnique({
      where: { userId_communityId: { userId, communityId } },
    });

    if (!existingMember) {
      await this.prisma.$transaction([
        this.prisma.communityMember.create({
          data: { userId, communityId, role: 'MEMBER' },
        }),
        this.prisma.community.update({
          where: { id: communityId },
          data: { memberCount: { increment: 1 } },
        }),
      ]);
    }

    return { success: true };
  }

  async leaveCommunity(communityId: string, userId: string) {
    const community = await this.prisma.community.findUnique({ where: { id: communityId } });
    if (!community) throw new NotFoundException('Community not found');

    const existingMember = await this.prisma.communityMember.findUnique({
      where: { userId_communityId: { userId, communityId } },
    });

    if (existingMember) {
      await this.prisma.$transaction([
        this.prisma.communityMember.delete({
          where: { userId_communityId: { userId, communityId } },
        }),
        this.prisma.community.update({
          where: { id: communityId },
          data: { memberCount: { decrement: 1 } },
        }),
      ]);
    }

    return { success: true };
  }

  async createCommunity(data: any, creatorId: string) {
    const slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const existing = await this.prisma.community.findUnique({ where: { slug } });
    const finalSlug = existing ? `${slug}-${Date.now()}` : slug;

    const createData: any = {
      name: data.name,
      description: data.description,
      avatarKey: data.avatarKey,
      slug: finalSlug,
      memberCount: 1,
      members: {
        create: [{ userId: creatorId, role: 'ADMIN' }]
      }
    };

    if (data.isCampusCommunity) {
      const user = await this.prisma.user.findUnique({ where: { id: creatorId }, select: { collegeId: true } });
      if (user?.collegeId) {
        createData.isCampusCommunity = true;
        createData.collegeId = user.collegeId;
      }
    }

    if (data.avatarKey && typeof data.avatarKey === 'string') {
      if (data.avatarKey.startsWith('/api/media/')) {
        createData.avatarMedia = { connect: { objectKey: data.avatarKey.replace('/api/media/', '') } };
      } else if (data.avatarKey.startsWith('http')) {
        createData.avatarMedia = { create: { provider: 'external', bucket: 'external', objectKey: data.avatarKey, mimeType: 'image/jpeg', fileSize: 0, ownerId: creatorId } };
      }
    }

    if (data.coverKey && typeof data.coverKey === 'string') {
      createData.coverKey = data.coverKey;
      if (data.coverKey.startsWith('/api/media/')) {
        createData.coverMedia = { connect: { objectKey: data.coverKey.replace('/api/media/', '') } };
      } else if (data.coverKey.startsWith('http')) {
        createData.coverMedia = { create: { provider: 'external', bucket: 'external', objectKey: data.coverKey, mimeType: 'image/jpeg', fileSize: 0, ownerId: creatorId } };
      }
    }

    return this.prisma.community.create({ data: createData });
  }

  async updateCommunity(communityId: string, data: any, requestingUserId: string) {
    const member = await this.prisma.communityMember.findUnique({
      where: { userId_communityId: { userId: requestingUserId, communityId } },
    });

    if (!member || member.role !== 'ADMIN') {
      throw new ForbiddenException('Only admins can update community info');
    }

    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    
    if (data.avatarKey !== undefined) {
      updateData.avatarKey = data.avatarKey;
      if (data.avatarKey && typeof data.avatarKey === 'string') {
        if (data.avatarKey.startsWith('/api/media/')) {
          updateData.avatarMedia = { connect: { objectKey: data.avatarKey.replace('/api/media/', '') } };
        } else if (data.avatarKey.startsWith('http')) {
          updateData.avatarMedia = { create: { provider: 'external', bucket: 'external', objectKey: data.avatarKey, mimeType: 'image/jpeg', fileSize: 0, ownerId: requestingUserId } };
        }
      }
    }

    if (data.coverKey !== undefined) {
      updateData.coverKey = data.coverKey;
      if (data.coverKey && typeof data.coverKey === 'string') {
        if (data.coverKey.startsWith('/api/media/')) {
          updateData.coverMedia = { connect: { objectKey: data.coverKey.replace('/api/media/', '') } };
        } else if (data.coverKey.startsWith('http')) {
          updateData.coverMedia = { create: { provider: 'external', bucket: 'external', objectKey: data.coverKey, mimeType: 'image/jpeg', fileSize: 0, ownerId: requestingUserId } };
        }
      }
    }

    return this.prisma.community.update({
      where: { id: communityId },
      data: updateData
    });
  }

  async removeMember(communityId: string, memberId: string, requestingUserId: string) {
    const requester = await this.prisma.communityMember.findUnique({
      where: { userId_communityId: { userId: requestingUserId, communityId } },
    });

    if (!requester || requester.role !== 'ADMIN') {
      throw new ForbiddenException('Only admins can remove members');
    }

    const memberToRemove = await this.prisma.communityMember.findUnique({
      where: { userId_communityId: { userId: memberId, communityId } },
    });

    const community = await this.prisma.community.findUnique({
      where: { id: communityId }
    });

    if (memberToRemove && community) {
      await this.prisma.$transaction([
        this.prisma.communityMember.delete({
          where: { userId_communityId: { userId: memberId, communityId } },
        }),
        this.prisma.community.update({
          where: { id: communityId },
          data: { memberCount: { decrement: 1 } }, 
        }),
      ]);
    }

    return { success: true };
  }

  async deleteCommunity(communityId: string, requestingUserId: string) {
    const community = await this.prisma.community.findUnique({
      where: { id: communityId },
      include: { members: { where: { userId: requestingUserId } } },
    });

    if (!community || community.deletedAt) {
      throw new NotFoundException('Community not found');
    }

    const member = community.members[0];
    const isOwner = community.ownerId === requestingUserId;
    const isAdmin = member?.role === 'ADMIN';

    if (!isOwner && !isAdmin) {
      throw new ForbiddenException('Only the community owner or admins can delete this community');
    }

    await this.prisma.community.update({
      where: { id: communityId },
      data: { deletedAt: new Date() },
    });

    return { success: true, communityId };
  }
}
