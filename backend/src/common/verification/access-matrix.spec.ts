import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { WsException } from '@nestjs/websockets';
import { VerificationStatus } from '@prisma/client';
import { VerificationGuard } from '../guards/verification.guard';
import { VerificationAccessService } from './verification-access.service';
import { stub } from '../testing/stub';
import type { PrismaService } from '../../prisma/prisma.service';
import type { DomainEventService } from '../../events/domain-event.service';
import { IS_VERIFIED_ONLY_KEY } from '../decorators/verified-only.decorator';
import { PostsController } from '../../posts/posts.controller';
import { CommunitiesController } from '../../communities/communities.controller';
import { ActivitiesController } from '../../activities/activities.controller';
import { ActivityDiscussionController } from '../../activities/discussion/activity-discussion.controller';
import { UsersController } from '../../users/users.controller';
import { CampusEventsController } from '../../campus-events/campus-events.controller';
import { DmController } from '../../messages/dm/dm.controller';
import { MessagesController } from '../../messages/messages.controller';
import { GroupChatsController } from '../../messages/group-chats/group-chats.controller';
import { RealtimeGateway } from '../../realtime/realtime.gateway';

/**
 * The access-control matrix: every account state against a gated action, over
 * both transports.
 *
 * The point is exhaustiveness. Enumerating `VerificationStatus` from the Prisma
 * enum rather than listing statuses by hand means a status added to the schema
 * later shows up here as a failing case that somebody has to classify, instead
 * of silently defaulting to "allowed".
 */
describe('verification access matrix', () => {
  const ELIGIBLE: VerificationStatus[] = [VerificationStatus.VERIFIED];
  const INELIGIBLE = Object.values(VerificationStatus).filter(
    (s) => !ELIGIBLE.includes(s),
  );

  let prisma: {
    user: { findUnique: jest.Mock; findMany: jest.Mock };
    conversationParticipant: { findMany: jest.Mock };
  };
  let access: VerificationAccessService;
  let guard: VerificationGuard;
  let reflector: Reflector;

  const context = (opts: {
    type: 'http' | 'ws';
    userId?: string;
  }): ExecutionContext =>
    stub<ExecutionContext>({
      getType: () => opts.type,
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({
          user: opts.userId ? { id: opts.userId } : undefined,
        }),
      }),
      switchToWs: () => ({
        // The gateway keeps a socket's identity in `socket.data`.
        getClient: () => ({ data: opts.userId ? { userId: opts.userId } : {} }),
      }),
    });

  const asUser = (status: VerificationStatus | null) => {
    access.invalidateAll();
    prisma.user.findUnique.mockResolvedValue(
      status
        ? {
            id: 'u1',
            verificationStatus: status,
            accountStatus: 'ACTIVE',
            deletedAt: null,
          }
        : null,
    );
    prisma.user.findMany.mockResolvedValue(
      status
        ? [
            {
              id: 'u1',
              verificationStatus: status,
              accountStatus: 'ACTIVE',
              deletedAt: null,
            },
          ]
        : [],
    );
  };

  beforeEach(() => {
    delete process.env.FEATURE_VERIFICATION_ENABLED;
    prisma = {
      user: { findUnique: jest.fn(), findMany: jest.fn() },
      conversationParticipant: { findMany: jest.fn(() => Promise.resolve([])) },
    };
    access = new VerificationAccessService(
      stub<PrismaService>(prisma),
      stub<DomainEventService>({ emit: jest.fn() }),
    );
    reflector = new Reflector();
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key) => key === IS_VERIFIED_ONLY_KEY);
    guard = new VerificationGuard(reflector, access);
  });

  describe.each(INELIGIBLE)('an account in %s', (status) => {
    it('is refused a gated HTTP action', async () => {
      asUser(status);
      await expect(
        guard.canActivate(context({ type: 'http', userId: 'u1' })),
      ).rejects.toThrow(ForbiddenException);
    });

    it('is refused a gated socket event', async () => {
      asUser(status);
      await expect(
        guard.canActivate(context({ type: 'ws', userId: 'u1' })),
      ).rejects.toThrow(WsException);
    });

    it('cannot open a direct conversation', async () => {
      asUser(status);
      await expect(
        access.assertUsersEligible(['u1', 'other'], 'u1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe.each(ELIGIBLE)('an account in %s', (status) => {
    it('is allowed a gated HTTP action', async () => {
      asUser(status);
      await expect(
        guard.canActivate(context({ type: 'http', userId: 'u1' })),
      ).resolves.toBe(true);
    });

    it('is allowed a gated socket event', async () => {
      asUser(status);
      await expect(
        guard.canActivate(context({ type: 'ws', userId: 'u1' })),
      ).resolves.toBe(true);
    });
  });

  it('refuses an account whose user row has vanished', async () => {
    asUser(null);
    await expect(
      guard.canActivate(context({ type: 'http', userId: 'ghost' })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('fails closed (401) for a request it cannot identify, rather than passing it as verified', async () => {
    // This guard is an APP_GUARD and runs BEFORE JwtGuard, so "no user on the
    // request" means nobody has been identified yet, not that JwtGuard already
    // refused it. Allowing it made @VerifiedOnly inert on HTTP.
    asUser(null);
    await expect(
      guard.canActivate(context({ type: 'http' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('opens everything when the feature flag is off', async () => {
    process.env.FEATURE_VERIFICATION_ENABLED = 'false';
    asUser(VerificationStatus.UNVERIFIED);
    await expect(
      guard.canActivate(context({ type: 'http', userId: 'u1' })),
    ).resolves.toBe(true);
  });
});

/**
 * Which routes carry the selfie gate (`@VerifiedOnly()`).
 *
 * Policy, not plumbing: docs/college-affiliation.md narrowed the gate to
 * messaging, creating posts / communities / activities and Instant Match.
 * Everything else a signed-in account does (likes, comments, follows, joins,
 * bookmarks, community and activity management, discussion posts) is open,
 * and campus surfaces are gated by a verified college email instead
 * (CampusAccessService). Listing both sides means a route that silently gains
 * or loses the gate fails here.
 */
describe('selfie gate route matrix', () => {
  type Ctor = { prototype: object; name: string };

  const gated = (ctor: Ctor, method: string): boolean => {
    const handler: unknown = Reflect.get(ctor.prototype, method);
    if (typeof handler !== 'function') {
      throw new Error(`${ctor.name}.${method} does not exist`);
    }
    return Reflect.getMetadata(IS_VERIFIED_ONLY_KEY, handler) === true;
  };

  const MATRIX: Array<[Ctor, string[], string[]]> = [
    [
      PostsController,
      ['createPost'],
      [
        'deletePost',
        'like',
        'unlike',
        'addComment',
        'likeComment',
        'unlikeComment',
        'deleteComment',
        'bookmark',
        'unbookmark',
        'voteInPoll',
      ],
    ],
    [
      CommunitiesController,
      ['createCommunity'],
      [
        'joinCommunity',
        'acceptJoinRequest',
        'declineJoinRequest',
        'updateCommunity',
        'updateMemberRole',
        'removeMember',
        'deleteCommunity',
        'getCampusCommunities',
      ],
    ],
    [
      ActivitiesController,
      ['createActivity'],
      [
        'acceptInvitation',
        'declineInvitation',
        'bookmarkActivity',
        'unbookmarkActivity',
        'updateVisibility',
        'joinActivity',
        'leaveActivity',
        'declineCrewInvitation',
        'cancelCrewActivity',
        'endCrewActivity',
        'inviteFriends',
        'revokeInvitation',
      ],
    ],
    [ActivityDiscussionController, [], ['sendMessage']],
    [
      UsersController,
      [],
      ['getCampusUsers', 'getDirectory', 'follow', 'unfollow'],
    ],
    [
      CampusEventsController,
      [],
      ['list', 'listMine', 'getById', 'create', 'update', 'publish', 'remove'],
    ],
    [DmController, ['startDM', 'sendMessage', 'forwardMessage'], []],
    [
      MessagesController,
      [
        'sendMessage',
        'forwardMessage',
        // Joining a group by invite (or requesting to) is messaging; so is
        // approving a request, which adds a member.
        'joinGroup',
        'requestJoinGroup',
        'acceptJoinRequest',
      ],
      ['declineJoinRequest', 'getInvitePreview'],
    ],
    [
      GroupChatsController,
      [
        'createGroup',
        'sendMessage',
        'addMember',
        'acceptJoinRequest',
        'joinGroup',
        'requestJoin',
      ],
      [
        'getInvitePreview',
        'updateGroupInfo',
        'removeMember',
        'changeOwner',
        'promoteAdmin',
        'demoteAdmin',
        'declineJoinRequest',
      ],
    ],
    [
      RealtimeGateway,
      [
        'handleQueueJoin',
        'handleMatchRespond',
        'handleQueueSync',
        'handleQueueList',
        'handleInstantMatchChatState',
        'handleInstantMatchLeave',
      ],
      [],
    ],
  ];

  describe.each(MATRIX.map(([c, k, o]) => [c.name, c, k, o] as const))(
    '%s',
    (_name, ctor, keep, open) => {
      it.each(keep.length ? keep : ['(none)'])('keeps the gate on %s', (m) => {
        if (m === '(none)') return;
        expect(gated(ctor, m)).toBe(true);
      });

      it.each(open.length ? open : ['(none)'])('has no gate on %s', (m) => {
        if (m === '(none)') return;
        expect(gated(ctor, m)).toBe(false);
      });
    },
  );
});
