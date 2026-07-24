import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CommunitiesService {
  constructor(private readonly prisma: PrismaService) {}

  async getAllCommunities(userId?: string, limit = 30, offset = 0) {
    const communities = await this.prisma.community.findMany({
      where: { deletedAt: null },
      orderBy: { memberCount: 'desc' },
      take: limit,
      skip: offset,
    });

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

    return this.prisma.community.create({
      data: {
        name: data.name,
        description: data.description,
        avatarKey: data.avatarKey,
        slug: finalSlug,
        memberCount: 1,
        members: {
          create: [{ userId: creatorId, role: 'ADMIN' }]
        }
      }
    });
  }

  async updateCommunity(communityId: string, data: any, requestingUserId: string) {
    const member = await this.prisma.communityMember.findUnique({
      where: { userId_communityId: { userId: requestingUserId, communityId } },
    });

    if (!member || member.role !== 'ADMIN') {
      throw new ForbiddenException('Only admins can update community info');
    }

    return this.prisma.community.update({
      where: { id: communityId },
      data: {
        name: data.name,
        description: data.description,
        avatarKey: data.avatarKey
      }
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
