import { Injectable, NotFoundException, BadRequestException, Logger, Inject, forwardRef, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationFactory } from '../notifications/notification.factory';
import { BlocksService } from '../users/blocks.service';
import { DomainEventService } from '../events/domain-event.service';

@Injectable()
export class ActivitiesService implements OnModuleInit {
  private readonly logger = new Logger(ActivitiesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly notificationFactory: NotificationFactory,
    private readonly blocksService: BlocksService,
    private readonly domainEventService: DomainEventService
  ) {}

  onModuleInit() {
    // Run auto-expiration every 60 seconds
    setInterval(() => {
      this.autoExpireActivities().catch(() => {});
    }, 60000);
  }

  async autoExpireActivities() {
    const now = new Date();
    try {
      const expiredList = await this.prisma.crewActivity.findMany({
        where: {
          status: 'OPEN',
          deletedAt: null,
          endDate: { lte: now }
        },
        select: { id: true }
      });

      if (expiredList && expiredList.length > 0) {
        const expiredIds = expiredList.map(a => a.id);
        await this.prisma.crewActivity.updateMany({
          where: { id: { in: expiredIds } },
          data: { status: 'ENDED' }
        });

        for (const actId of expiredIds) {
          this.domainEventService.emit('activity.updated', { id: actId, status: 'ENDED' });
        }
      }
    } catch (err) {
      this.logger.error('Failed to auto-expire activities', err);
    }
  }

  async getAllActivities(userId?: string) {

    const excludedUserIds = userId ? await this.blocksService.getExcludedUserIds(userId) : [];

    const whereClause: any = {
      deletedAt: null,
      creatorId: { notIn: excludedUserIds }
    };

    if (userId) {
      whereClause.OR = [
        { status: 'OPEN' },
        { creatorId: userId },
        { members: { some: { userId } } }
      ];
    } else {
      whereClause.status = 'OPEN';
    }

    const activities = await this.prisma.crewActivity.findMany({
      where: whereClause,
      take: 50,
      include: {
        _count: { select: { members: true } },
        members: {
          take: 5,
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

    const myMemberships = userId ? await this.prisma.crewActivityMember.findMany({
      where: { userId, activityId: { in: activities.map(a => a.id) } }
    }) : [];
    const membershipMap = new Map(myMemberships.map(m => [m.activityId, m.status]));

    return activities.map(a => {
      const myStatus = membershipMap.get(a.id);
      return {
        ...a,
        isJoined: myStatus === 'MEMBER',
        myStatus: myStatus || null,
      };
    });
  }

  async getCampusActivities(userId: string) {
    if (!userId) return [];
    const excludedUserIds = await this.blocksService.getExcludedUserIds(userId);
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { collegeId: true } });
    if (!user?.collegeId) return [];

    const whereClause: any = {
      deletedAt: null,
      creatorId: { notIn: excludedUserIds },
      shareToCampus: true,
      collegeId: user.collegeId,
    };

    if (userId) {
      whereClause.OR = [
        { status: 'OPEN' },
        { creatorId: userId },
        { members: { some: { userId } } }
      ];
    } else {
      whereClause.status = 'OPEN';
    }

    const activities = await this.prisma.crewActivity.findMany({
      where: whereClause,
      take: 50,
      include: {
        _count: { select: { members: true } },
        members: {
          take: 5,
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

    const myMemberships = await this.prisma.crewActivityMember.findMany({
      where: { userId, activityId: { in: activities.map(a => a.id) } }
    });
    const membershipMap = new Map(myMemberships.map(m => [m.activityId, m.status]));

    return activities.map(a => {
      const myStatus = membershipMap.get(a.id);
      return {
        ...a,
        isJoined: myStatus === 'MEMBER',
        myStatus: myStatus || null,
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
    if (!data.title || typeof data.title !== 'string' || data.title.trim().length === 0) {
      throw new BadRequestException('Title is required');
    }
    if (data.title.trim().length > 30) {
      throw new BadRequestException('Title cannot exceed 30 characters');
    }
    if (data.description && data.description.length > 500) {
      throw new BadRequestException('Description cannot exceed 500 characters');
    }
    if (data.location && data.location.length > 100) {
      throw new BadRequestException('Location cannot exceed 100 characters');
    }
    if (data.startDate && data.endDate) {
      const start = new Date(data.startDate);
      const end = new Date(data.endDate);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        throw new BadRequestException('Invalid start or end date');
      }
      if (end <= start) {
        throw new BadRequestException('End date must be after start date');
      }
      const maxDurationMs = 30 * 24 * 60 * 60 * 1000; // 30 days
      if (end.getTime() - start.getTime() > maxDurationMs) {
        throw new BadRequestException('Activity duration cannot exceed 30 days');
      }
    }

    const createData: any = {
      creatorId,
      title: data.title,
      description: data.description,
      coverImage: data.coverImage,
      startDate: data.startDate ? new Date(data.startDate) : null,
      endDate: data.endDate ? new Date(data.endDate) : null,
      location: data.location,
      createActivityGroup: data.createActivityGroup,
      maxMembers: data.maxMembers ? parseInt(data.maxMembers, 10) : null,
      members: {
        create: [{ userId: creatorId, status: 'MEMBER' }],
      },
    };

    if (data.shareToCampus) {
      const user = await this.prisma.user.findUnique({ where: { id: creatorId }, select: { collegeId: true } });
      if (user?.collegeId) {
        createData.shareToCampus = true;
        createData.collegeId = user.collegeId;
      }
    }

    const createdActivity = await this.prisma.crewActivity.create({
      data: createData,
      include: {
        members: { include: { user: true } },
      },
    });

    if (createdActivity.createActivityGroup) {
      const convId = `act_${createdActivity.id}`;
      await this.prisma.conversation.upsert({
        where: { id: convId },
        update: { name: createdActivity.title, avatarKey: createdActivity.coverImage },
        create: {
          id: convId,
          name: createdActivity.title,
          avatarKey: createdActivity.coverImage,
          type: 'GROUP',
          isActivityChat: true,
          activityId: createdActivity.id,
          ownerId: creatorId,
          participants: {
            create: [{ userId: creatorId, role: 'OWNER' }]
          },
          messages: {
            create: [{
              senderId: creatorId,
              payload: { text: 'Activity group chat created' },
              type: 'SYSTEM'
            }]
          }
        }
      }).catch(() => {});
    }

    return createdActivity;
  }

  async joinActivity(activityId: string, userId: string): Promise<any> {
    const activity = await this.prisma.crewActivity.findUnique({
      where: { id: activityId },
      include: { members: true },
    });

    if (!activity) {
      throw new NotFoundException('Activity not found');
    }

    if (activity.status !== 'OPEN') {
      throw new BadRequestException('Activity is not open for joining');
    }

    const startRaw = activity.startDate || (activity as any).date;
    if (startRaw && new Date(startRaw) <= new Date()) {
      throw new BadRequestException('Activity has already started and cannot be joined');
    }

    const existingMember = activity.members.find(m => m.userId === userId);
    if (existingMember) {
      if (existingMember.status === 'MEMBER') throw new BadRequestException('Already a member of this activity');
      if (existingMember.status === 'PENDING') throw new BadRequestException('Join request already pending');
    }

    if (activity.maxMembers && activity.members.filter(m => m.status === 'MEMBER').length >= activity.maxMembers) {
      throw new BadRequestException('Activity is full');
    }

    await this.prisma.crewActivityMember.upsert({
      where: { userId_activityId: { userId, activityId } },
      update: { status: 'MEMBER' },
      create: { userId, activityId, status: 'MEMBER' },
    });

    const actor = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, displayName: true, username: true, avatar: true }
    });

    if (activity.createActivityGroup) {
      try {
        const convId = `act_${activityId}`;
        const userHandle = actor?.username ? `@${actor.username}` : (actor?.displayName || 'Someone');

        // Ensure conversation record exists
        await this.prisma.conversation.upsert({
          where: { id: convId },
          update: { name: activity.title, avatarKey: activity.coverImage },
          create: {
            id: convId,
            name: activity.title,
            avatarKey: activity.coverImage,
            type: 'GROUP',
            isActivityChat: true,
            activityId: activity.id,
            ownerId: activity.creatorId,
            participants: {
              create: [{ userId: activity.creatorId, role: 'OWNER' }]
            }
          }
        }).catch(() => {});

        await this.prisma.conversationParticipant.upsert({
          where: { userId_conversationId: { userId, conversationId: convId } },
          update: { role: 'MEMBER', leftAt: null, deletedAt: null } as any,
          create: { conversationId: convId, userId, role: 'MEMBER' }
        }).catch(() => {});

        const sysMsg = await this.prisma.message.create({
          data: {
            conversationId: convId,
            senderId: userId,
            payload: { text: `${userHandle} joined the activity` },
            type: 'SYSTEM'
          }
        }).catch(() => null);

        if (sysMsg) {
          const formattedMsg = {
            id: sysMsg.id,
            conversationId: convId,
            publicId: convId,
            internalId: convId,
            senderId: userId,
            senderName: 'System',
            senderAvatar: '',
            from: 'them',
            createdAt: sysMsg.createdAt,
            timestamp: sysMsg.createdAt,
            time: new Date(sysMsg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            type: 'system',
            text: `${userHandle} joined the activity`,
            payload: { text: `${userHandle} joined the activity` },
            status: 'sent'
          };

          const membersList = await this.prisma.crewActivityMember.findMany({
            where: { activityId },
            select: { userId: true }
          }).catch(() => []);

          const participantsList = await this.prisma.conversationParticipant.findMany({
            where: { conversationId: convId, leftAt: null, deletedAt: null } as any,
            select: { userId: true }
          }).catch(() => []);

          const recipientUserIds = Array.from(new Set([
            userId,
            activity.creatorId,
            ...membersList.map(m => m.userId),
            ...participantsList.map(p => p.userId)
          ].filter(Boolean)));

          this.domainEventService.emit('message:new', formattedMsg, recipientUserIds);
          this.domainEventService.emit('conversation:updated', {
            conversationId: convId,
            publicId: convId,
            internalId: convId,
            lastMessage: {
              text: `${userHandle} joined the activity`,
              createdAt: sysMsg.createdAt,
              senderId: userId
            }
          }, recipientUserIds);
        }
      } catch (err) {
        this.logger.warn('Failed group chat update during joinActivity', err);
      }
    }

    return { success: true };
  }

  async leaveActivity(activityId: string, userId: string) {
    const activity = await this.prisma.crewActivity.findUnique({
      where: { id: activityId },
      select: { creatorId: true, createActivityGroup: true, title: true, coverImage: true, startDate: true, status: true },
    });

    if (activity && activity.creatorId === userId) {
      throw new BadRequestException('Host cannot leave their own activity');
    }

    const actor = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true, username: true }
    });

    const existingMember = await this.prisma.crewActivityMember.findUnique({
      where: { userId_activityId: { userId, activityId } }
    });

    if (existingMember) {
      await this.prisma.crewActivityMember.delete({
        where: { userId_activityId: { userId, activityId } }
      });

      if (activity?.createActivityGroup) {
        try {
          const convId = `act_${activityId}`;
          const userHandle = actor?.username ? `@${actor.username}` : (actor?.displayName || 'Someone');

          const startRaw = (activity as any)?.startDate;
          const activityStatus = (activity as any)?.status;
          const hasStarted = (activityStatus === 'STARTED' || activityStatus === 'IN_PROGRESS' || activityStatus === 'ENDED') || (startRaw && new Date(startRaw) <= new Date());

          if (!hasStarted) {
            // Pre-activity: completely remove participant record so chat disappears from message section
            await this.prisma.conversationParticipant.deleteMany({
              where: { conversationId: convId, userId }
            }).catch(() => {});
          } else {
            // Post-activity: set leftAt timestamp so chat remains read-only in message section
            await this.prisma.conversationParticipant.updateMany({
              where: { conversationId: convId, userId },
              data: { leftAt: new Date() } as any
            }).catch(() => {});
          }

          const sysMsg = await this.prisma.message.create({
            data: {
              conversationId: convId,
              senderId: userId,
              payload: { text: `${userHandle} left the activity` },
              type: 'SYSTEM'
            }
          }).catch(() => null);

          if (sysMsg) {
            const formattedMsg = {
              id: sysMsg.id,
              conversationId: convId,
              publicId: convId,
              internalId: convId,
              senderId: userId,
              senderName: 'System',
              senderAvatar: '',
              from: 'them',
              createdAt: sysMsg.createdAt,
              timestamp: sysMsg.createdAt,
              time: new Date(sysMsg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              type: 'system',
              text: `${userHandle} left the activity`,
              payload: { text: `${userHandle} left the activity` },
              status: 'sent'
            };

            const membersList = await this.prisma.crewActivityMember.findMany({
              where: { activityId },
              select: { userId: true }
            }).catch(() => []);

            const participantsList = await this.prisma.conversationParticipant.findMany({
              where: { conversationId: convId, leftAt: null, deletedAt: null } as any,
              select: { userId: true }
            }).catch(() => []);

            const recipientUserIds = Array.from(new Set([
              userId,
              activity?.creatorId,
              ...membersList.map(m => m.userId),
              ...participantsList.map(p => p.userId)
            ].filter(Boolean))) as string[];

            this.domainEventService.emit('message:new', formattedMsg, recipientUserIds);
            this.domainEventService.emit('conversation:updated', {
              conversationId: convId,
              publicId: convId,
              internalId: convId,
              lastMessage: {
                text: `${userHandle} left the activity`,
                createdAt: sysMsg.createdAt,
                senderId: userId
              }
            }, recipientUserIds);
          }
        } catch (err) {
          this.logger.warn('Failed group chat update during leaveActivity', err);
        }
      }
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

    const startRaw = activity.startDate || (activity as any).date;
    if (startRaw && new Date(startRaw) <= new Date()) {
      throw new BadRequestException('Activity has already started and cannot be joined');
    }

    if (activity.participationType === 'OPEN') {
      return this.joinActivity(activityId, userId);
    }

    // participationType === 'APPROVAL'
    await this.prisma.crewActivityMember.upsert({
      where: { userId_activityId: { userId, activityId } },
      update: { status: 'PENDING' },
      create: { userId, activityId, status: 'PENDING' }
    });



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

    if (activity.createActivityGroup) {
      const convId = `act_${activityId}`;
      const actor = await this.prisma.user.findUnique({
        where: { id: requesterId },
        select: { displayName: true, username: true }
      });
      const userHandle = actor?.username ? `@${actor.username}` : (actor?.displayName || 'Someone');

      await this.prisma.conversationParticipant.upsert({
        where: { userId_conversationId: { userId: requesterId, conversationId: convId } },
        update: { role: 'MEMBER' },
        create: { conversationId: convId, userId: requesterId, role: 'MEMBER' }
      }).catch(() => {});

      await this.prisma.message.create({
        data: {
          conversationId: convId,
          senderId: requesterId,
          payload: { text: `${userHandle} joined the activity` },
          type: 'SYSTEM'
        }
      }).catch(() => {});
    }

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

    const startRaw = activity.startDate || (activity as any).date;
    const hasStarted = startRaw ? new Date(startRaw) <= new Date() : false;

    if (!hasStarted) {
      const convId = `act_${activityId}`;
      await this.prisma.conversation.delete({
        where: { id: convId }
      }).catch(() => {});

      await this.prisma.crewActivity.delete({
        where: { id: activityId }
      }).catch(async () => {
        await this.prisma.crewActivity.update({
          where: { id: activityId },
          data: { status: 'CANCELLED' }
        });
      });
    } else {
      await this.prisma.crewActivity.update({
        where: { id: activityId },
        data: { status: 'ENDED' }
      });
    }

    return { success: true };
  }
}
