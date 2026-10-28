import { Test, TestingModule } from '@nestjs/testing';
import { MessagesService } from './messages.service';
import { PrismaService } from '../prisma/prisma.service';
import { PresenceService } from '../presence/presence.service';
import { DomainEventService } from '../events/domain-event.service';
import { MentionsService } from '../mentions/mentions.service';
import { RedisService } from '../redis/redis.service';
import { BlocksService } from '../users/blocks.service';
import { verificationAccessMockProvider } from '../common/verification/testing/verification-access.mock';
import { allowAllRateLimitProvider } from '../common/rate-limit/testing/rate-limit.mock';
import { previewText } from './core/message-preview';

/**
 * The inbox, as one viewer may see it.
 *
 * Every row's preview came from the conversation's shared last-message
 * columns. A member removed from a group therefore kept seeing, in their own
 * list, the text of every message the group sent after they were gone, with
 * the row jumping to the top each time; and a message deleted for oneself
 * stayed as the row's preview.
 */
const VIEWER = 'viewer';
const at = (min: number) => new Date(Date.UTC(2026, 9, 28, 10, min));

type Row = {
  isMuted: boolean;
  isPinned: boolean;
  pinnedAt: null;
  clearedAt: Date | null;
  lastReadAt: null;
  unreadCount: number;
  groupUpdatesActive: boolean;
  leftAt: Date | null;
  leftGroupName: string | null;
  leftGroupAvatarKey: string | null;
  joinedAt: Date;
  conversation: Record<string, unknown>;
};

const groupRow = (
  id: string,
  over: Partial<Row> = {},
  conv: Record<string, unknown> = {},
): Row => ({
  isMuted: false,
  isPinned: false,
  pinnedAt: null,
  clearedAt: null,
  lastReadAt: null,
  unreadCount: 0,
  groupUpdatesActive: true,
  leftAt: null,
  leftGroupName: null,
  leftGroupAvatarKey: null,
  joinedAt: at(0),
  ...over,
  conversation: {
    id,
    publicId: `pub-${id}`,
    name: 'Crew',
    avatarKey: null,
    description: null,
    type: 'GROUP',
    ownerId: 'owner',
    status: 'ACTIVE',
    lastMessageId: `last-${id}`,
    lastMessageText: 'said after you left',
    lastMessageType: 'CHAT',
    lastMessageAt: at(5),
    lastMessageSenderId: 'someone',
    isInstantMatch: false,
    expiresAt: null,
    createdAt: at(0),
    updatedAt: at(6),
    whoCanJoin: 'ANYONE',
    visibility: 'PUBLIC',
    allowSharing: true,
    editGroupPermission: 'ADMIN',
    _count: { participants: 4 },
    ...conv,
  },
});

type FindFirstArgs = {
  where: {
    conversationId: string;
    createdAt?: { lte?: Date; gt?: Date };
    deletedByUsers?: unknown;
  };
};

describe('getUserConversations — what one viewer may see', () => {
  let service: MessagesService;
  let rows: Row[];
  let deletedForViewer: string[];
  let findFirst: jest.Mock<Promise<unknown>, [FindFirstArgs]>;

  beforeEach(async () => {
    rows = [];
    deletedForViewer = [];
    findFirst = jest.fn((args: FindFirstArgs) =>
      Promise.resolve({
        id: `visible-${args.where.conversationId}`,
        createdAt: at(2),
        senderId: 'someone',
        type: 'MEDIA',
        state: 'NORMAL',
        payload: { mediaUrl: 'voice/a.webm', mediaType: 'audio' },
      }),
    );
    const prisma = {
      conversationParticipant: {
        findMany: jest
          .fn()
          .mockImplementationOnce(() => Promise.resolve(rows))
          .mockResolvedValue([]),
      },
      deletedMessage: {
        findMany: jest.fn(() =>
          Promise.resolve(deletedForViewer.map((messageId) => ({ messageId }))),
        ),
      },
      message: { findFirst },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        allowAllRateLimitProvider(),
        verificationAccessMockProvider(),
        MessagesService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: PresenceService,
          useValue: { getPresenceMany: jest.fn().mockResolvedValue(new Map()) },
        },
        { provide: DomainEventService, useValue: { emit: jest.fn() } },
        { provide: MentionsService, useValue: {} },
        {
          provide: RedisService,
          useValue: {
            getClient: jest.fn().mockReturnValue(null),
            getSubClient: jest.fn().mockReturnValue(null),
          },
        },
        {
          provide: BlocksService,
          useValue: {
            getExcludedUserIds: jest.fn().mockResolvedValue([]),
            getBlockedByUserIds: jest.fn().mockResolvedValue([]),
          },
        },
      ],
    }).compile();
    service = module.get(MessagesService);
  });

  it('a former member sees the group as it was when they left: its name and photo then, no live count or description', async () => {
    rows = [
      groupRow(
        'g1',
        {
          leftAt: at(3),
          leftGroupName: 'Crew',
          leftGroupAvatarKey: 'groups/old.webp',
        },
        {
          name: 'Renamed later',
          avatarKey: 'groups/new.webp',
          description: 'A new description',
          _count: { participants: 9 },
        },
      ),
    ];
    const [row] = await service.getUserConversations(VIEWER, 50, 0);
    expect(row).toMatchObject({
      isMember: false,
      name: 'Crew',
      avatar: 'groups/old.webp',
      description: null,
      memberCount: 0,
    });
  });

  it('a group without a photo when they left stays without one', async () => {
    rows = [
      groupRow(
        'g1',
        { leftAt: at(3), leftGroupName: 'Crew', leftGroupAvatarKey: null },
        { avatarKey: 'groups/new.webp' },
      ),
    ];
    const [row] = await service.getUserConversations(VIEWER, 50, 0);
    expect(row).toMatchObject({ name: 'Crew', avatar: null });
  });

  it('a current member sees the group as it is now', async () => {
    rows = [
      groupRow(
        'g1',
        {},
        {
          name: 'Renamed later',
          avatarKey: 'groups/new.webp',
          description: 'A new description',
        },
      ),
    ];
    const [row] = await service.getUserConversations(VIEWER, 50, 0);
    expect(row).toMatchObject({
      isMember: true,
      name: 'Renamed later',
      avatar: 'groups/new.webp',
      description: 'A new description',
      memberCount: 4,
    });
  });

  it('a removed member sees their last message from before they were removed, nothing after', async () => {
    rows = [groupRow('g1', { leftAt: at(3), unreadCount: 7 })];
    const [row] = await service.getUserConversations(VIEWER, 50, 0);

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          conversationId: 'g1',
          createdAt: { lte: at(3) },
        }) as unknown,
      }),
    );
    expect(row.lastMessage).toMatchObject({
      id: 'visible-g1',
      text: 'Voice message',
    });
    expect(JSON.stringify(row)).not.toContain('said after you left');
    // Dated and sorted by when they left, not by the group's activity since.
    expect(row.updatedAt).toEqual(at(3));
    expect(row.unreadCount).toBe(0);
    expect(row.canSendMessages).toBe(false);
    expect(row.isMember).toBe(false);
  });

  it('a removed member whose group has been quiet since keeps the shared preview, with no extra query', async () => {
    rows = [
      groupRow(
        'g1',
        { leftAt: at(8) },
        { lastMessageAt: at(5), updatedAt: at(5) },
      ),
    ];
    const [row] = await service.getUserConversations(VIEWER, 50, 0);
    expect(findFirst).not.toHaveBeenCalled();
    expect(row.lastMessage).toMatchObject({ text: 'said after you left' });
  });

  it('a current member sees the shared preview, with no extra query', async () => {
    rows = [groupRow('g1', { unreadCount: 2 })];
    const [row] = await service.getUserConversations(VIEWER, 50, 0);
    expect(findFirst).not.toHaveBeenCalled();
    expect(row).toMatchObject({ unreadCount: 2, canSendMessages: true });
    expect(row.lastMessage).toMatchObject({
      id: 'last-g1',
      text: 'said after you left',
    });
  });

  it('a latest message deleted for the viewer gives way to the one before it', async () => {
    rows = [groupRow('g1')];
    deletedForViewer = ['last-g1'];
    const [row] = await service.getUserConversations(VIEWER, 50, 0);
    const where = findFirst.mock.calls[0][0].where;
    expect(where.deletedByUsers).toEqual({ none: { userId: VIEWER } });
    expect(row.lastMessage).toMatchObject({ id: 'visible-g1' });
  });

  it('the fallback still respects a clear: nothing at or before it is shown', async () => {
    rows = [groupRow('g1', { leftAt: at(3), clearedAt: at(2) })];
    findFirst.mockResolvedValueOnce(null);
    const [row] = await service.getUserConversations(VIEWER, 50, 0);
    expect(findFirst.mock.calls[0][0].where.createdAt).toEqual({
      lte: at(3),
      gt: at(2),
    });
    expect(row.lastMessage).toBeNull();
  });
});

describe('previewText: one line per kind of message', () => {
  it.each([
    [{ payload: { text: 'hello' } }, 'hello'],
    [
      { payload: { text: '  ', mediaUrl: 'chat/a.webp', mediaType: 'image' } },
      'Photo',
    ],
    [{ payload: { mediaUrl: 'chat/a.mp4', mediaType: 'video' } }, 'Video'],
    [
      { payload: { mediaUrl: 'voice/a.webm', mediaType: 'audio' } },
      'Voice message',
    ],
    [{ payload: { mediaUrl: 'chat/a.bin', mediaType: 'pdf' } }, 'Attachment'],
    [
      { payload: { inviteData: { type: 'postShare', postId: 'p' } } },
      'Shared a post',
    ],
    [
      { payload: { inviteData: { type: 'activityShare' } } },
      'Shared an activity',
    ],
    [
      {
        payload: { inviteData: { type: 'confessionShare', confessionId: 'c' } },
      },
      'Shared a confession',
    ],
    [
      {
        payload: { inviteData: { type: 'group_invite', groupName: 'Hikers' } },
      },
      'Group invite: Hikers',
    ],
    [
      { state: 'UNSENT', payload: { text: 'secret' } },
      'This message was unsent',
    ],
    [
      { type: 'SYSTEM', payload: { text: '@ana joined the group' } },
      '@ana joined the group',
    ],
    [{ payload: {} }, 'Message'],
  ])('%o → %s', (message, expected) => {
    expect(previewText(message)).toBe(expected);
  });
});
