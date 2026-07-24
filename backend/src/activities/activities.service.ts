import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationFactory } from '../notifications/notification.factory';
import { BlocksService } from '../users/blocks.service';

@Injectable()
export class ActivitiesService {
  private readonly logger = new Logger(ActivitiesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly notificationFactory: NotificationFactory,
    private readonly blocksService: BlocksService
  ) {}

  async getAllActivities(userId?: string) {
    const excludedUserIds = userId ? await this.blocksService.getExcludedUserIds(userId) : [];
    const activities = await this.prisma.crewActivity.findMany({
      where: {
        status: 'OPEN',
        deletedAt: null,
        creatorId: { notIn: excludedUserIds }
      },
      take: 50,
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
      },
      orderBy: { createdAt: 'desc' },
    });

    return activities.map(a => {
      const myMembership = userId ? a.members.find(m => m.userId === userId) : null;
      return {
        ...a,
        isJoined: myMembership?.status === 'MEMBER',
        myStatus: myMembership?.status || null,
      };
    });
  }

  async getActivityById(id: string, userId?: string) {
    const activity = await this.prisma.crewActivity.findUnique({
      where: { id },
      include: {
        members: {
          include: { user: { select: { id: true, username: true, displayName: true, avatar: true } } }
        },
        creator: { select: { id: true, username: true, displayName: true, avatar: true } },
      },
    });
    const excludedUserIds = userId ? await this.blocksService.getExcludedUserIds(userId) : [];
    if (!activity || (excludedUserIds.length > 0 && excludedUserIds.includes(activity.creatorId))) {
      throw new NotFoundException('Activity not found');
    }
    const myMembership = userId ? activity.members.find(m => m.userId === userId) : null;
    return {
      ...activity,
      isJoined: myMembership?.status === 'MEMBER',
      myStatus: myMembership?.status || null,
    };
  }

  async createActivity(data: any, creatorId: string) {
    return this.prisma.crewActivity.create({
      data: {
        creatorId,
        title: data.title,
        description: data.description,
        coverImage: data.coverImage,
        startDate: data.startDate,
        endDate: data.endDate,
        location: data.location,
        createActivityGroup: data.createActivityGroup,
        maxMembers: data.maxMembers ? parseInt(data.maxMembers, 10) : null,
        members: {
          create: [{ userId: creatorId, status: 'MEMBER' }],
        },
      },
      include: {
        members: { include: { user: true } },
      },
    });
  }

  async joinActivity(activityId: string, userId: string): Promise<any> {
    const activity = await this.prisma.crewActivity.findUnique({
      where: { id: activityId },
      include: { members: true },
    });

    if (!activity) throw new NotFoundException('Activity not found');
    if (activity.status === 'ENDED' || activity.status === 'CANCELLED') throw new BadRequestException('Activity is no longer open');

    const existingMember = activity.members.find((m) => m.userId === userId);
    if (existingMember) {
      if (existingMember.status === 'MEMBER') return { success: true }; // already joined
      if (existingMember.status === 'PENDING') throw new BadRequestException('Join request already pending');
    }

    if (activity.maxMembers && activity.members.filter(m => m.status === 'MEMBER').length >= activity.maxMembers) {
      throw new BadRequestException('Activity is full');
    }

    if (activity.participationType === 'APPROVAL') {
      return this.requestToJoinActivity(activityId, userId);
    }

    await this.prisma.crewActivityMember.upsert({
      where: { userId_activityId: { userId, activityId } },
      update: { status: 'MEMBER' },
      create: { userId, activityId, status: 'MEMBER' },
    });

    if (activity.creatorId !== userId) {
      this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, displayName: true, username: true, avatar: true } }).then(actor => {
        if (actor) {
          const dto = this.notificationFactory.createActivityJoin(actor, activity, activity.creatorId);
          this.notificationsService.createNotification(dto).catch(err => {
            this.logger.warn('Failed to send activity join notification', err);
          });
        }
      }).catch(err => {
        this.logger.warn('Failed to fetch actor for activity join notification', err);
      });
    }

    return { success: true };
  }

  async leaveActivity(activityId: string, userId: string) {
    const existingMember = await this.prisma.crewActivityMember.findUnique({
      where: { userId_activityId: { userId, activityId } }
    });

    if (existingMember) {
      await this.prisma.crewActivityMember.delete({
        where: { userId_activityId: { userId, activityId } }
      });
    }

    return { success: true };
  }

  async requestToJoinActivity(activityId: string, userId: string): Promise<any> {
    const activity = await this.prisma.crewActivity.findUnique({
      where: { id: activityId },
      include: { members: true }
    });
    if (!activity) throw new NotFoundException('Activity not found');
    if (activity.status !== 'OPEN') throw new BadRequestException('Activity not open');

    if (activity.participationType === 'OPEN') {
      return this.joinActivity(activityId, userId);
    }

    // participationType === 'APPROVAL'
    await this.prisma.crewActivityMember.upsert({
      where: { userId_activityId: { userId, activityId } },
      update: { status: 'PENDING' },
      create: { userId, activityId, status: 'PENDING' }
    });

    if (activity.creatorId !== userId) {
      this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, displayName: true, username: true, avatar: true } }).then(actor => {
        if (actor) {
          const dto = this.notificationFactory.createActivityJoinRequest(actor, activity, activity.creatorId);
          this.notificationsService.createNotification(dto).catch(err => {
            this.logger.warn('Failed to send activity join request notification', err);
          });
        }
      }).catch(err => {
        this.logger.warn('Failed to fetch actor for activity join request notification', err);
      });
    }

    return { success: true, pending: true };
  }

  async acceptJoinRequest(activityId: string, currentUserId: string, requesterId: string) {
    const activity = await this.prisma.crewActivity.findUnique({
      where: { id: activityId, creatorId: currentUserId }
    });
    if (!activity) throw new NotFoundException('Activity not found or you are not creator');

    await this.prisma.crewActivityMember.update({
      where: { userId_activityId: { userId: requesterId, activityId } },
      data: { status: 'MEMBER' }
    });
    return { success: true };
  }

  async rejectJoinRequest(activityId: string, currentUserId: string, requesterId: string) {
    const activity = await this.prisma.crewActivity.findUnique({
      where: { id: activityId, creatorId: currentUserId }
    });
    if (!activity) throw new NotFoundException('Activity not found or you are not creator');

    await this.prisma.crewActivityMember.update({
      where: { userId_activityId: { userId: requesterId, activityId } },
      data: { status: 'DECLINED' }
    });
    return { success: true };
  }

  async declineCrewInvitation(activityId: string, userId: string) {
    await this.prisma.crewActivityMember.updateMany({
      where: { activityId, userId, status: 'PENDING' },
      data: { status: 'DECLINED' }
    });
    return { success: true };
  }

  async endCrewActivity(activityId: string, currentUserId: string) {
    const activity = await this.prisma.crewActivity.findUnique({
      where: { id: activityId, creatorId: currentUserId }
    });
    if (!activity) throw new NotFoundException('Activity not found or you are not creator');

    await this.prisma.crewActivity.update({
      where: { id: activityId },
      data: { status: 'ENDED' }
    });
    return { success: true };
  }
}
