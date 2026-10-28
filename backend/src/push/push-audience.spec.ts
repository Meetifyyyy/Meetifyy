import { stub } from '../common/testing/stub';
import { PrismaService } from '../prisma/prisma.service';
import { PushAudienceService } from './push-audience.service';

/**
 * Recipient authorization at SEND time: anything that stopped being true
 * between the event and the worker suppresses the push.
 */
const activeUser = (over: Record<string, unknown> = {}) => ({
  deletedAt: null,
  accountStatus: 'ACTIVE',
  settings: { pushNotifs: true },
  notificationPrefs: null,
  username: 'aarav',
  displayName: 'Aarav',
  ...over,
});

const likeRow = () => ({
  id: 'n1',
  recipientId: 'author',
  actorId: 'liker',
  type: 'LIKE',
  entityType: 'POST',
  entityId: 'post-1',
  metadata: {
    postId: 'post-1',
    aggregatedCount: 1,
    postPreview: 'secret text',
  },
  readAt: null,
  deletedAt: null,
  updatedAt: new Date(),
});

function build() {
  const users: Record<string, ReturnType<typeof activeUser> | null> = {
    author: activeUser(),
    liker: activeUser(),
  };
  const prisma = {
    user: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(users[where.id] ?? null),
      ),
    },
    notification: {
      findUnique: jest.fn().mockResolvedValue(likeRow()),
    },
    block: { findFirst: jest.fn().mockResolvedValue(null) },
    post: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ deletedAt: null, authorId: 'author' }),
    },
    comment: { findUnique: jest.fn() },
    follow: { findUnique: jest.fn() },
    activityInvitation: { findUnique: jest.fn() },
    crewActivity: { findUnique: jest.fn() },
    crewActivityMember: { findUnique: jest.fn() },
    community: { findUnique: jest.fn() },
    communityMember: { findUnique: jest.fn() },
    communityJoinRequest: { findUnique: jest.fn() },
    conversationParticipant: {
      findUnique: jest.fn().mockResolvedValue({
        unreadCount: 2,
        isMuted: false,
        leftAt: null,
        deletedAt: null,
        conversation: {
          id: 'conv-1',
          publicId: 'pub-1',
          name: null,
          type: 'DM',
        },
      }),
    },
  };
  return {
    prisma,
    users,
    audience: new PushAudienceService(stub<PrismaService>(prisma)),
  };
}

describe('PushAudienceService.forNotification', () => {
  it('allows a live like and exposes no content to the payload builder', async () => {
    const { audience } = build();
    const input = await audience.forNotification('n1', 'author');
    expect(input).toMatchObject({ actorName: 'Aarav', entityId: 'post-1' });
    expect(JSON.stringify(input)).not.toContain('secret text');
  });

  it('suppresses when the post was deleted meanwhile', async () => {
    const { audience, prisma } = build();
    prisma.post.findUnique.mockResolvedValue({
      deletedAt: new Date(),
      authorId: 'author',
    });
    expect(await audience.forNotification('n1', 'author')).toBeNull();
  });

  it('suppresses an unliked (soft-deleted) or already-read row', async () => {
    const { audience, prisma } = build();
    const row = likeRow();
    prisma.notification.findUnique.mockResolvedValueOnce({
      ...row,
      deletedAt: new Date(),
    });
    expect(await audience.forNotification('n1', 'author')).toBeNull();
    prisma.notification.findUnique.mockResolvedValueOnce({
      ...row,
      readAt: new Date(),
    });
    expect(await audience.forNotification('n1', 'author')).toBeNull();
  });

  it('suppresses a job addressed to someone other than the row recipient', async () => {
    const { audience } = build();
    expect(await audience.forNotification('n1', 'someone-else')).toBeNull();
  });

  it('respects the master switch, the category switch, suspension and blocks', async () => {
    const { audience, users, prisma } = build();
    users.author = activeUser({ settings: { pushNotifs: false } });
    expect(await audience.forNotification('n1', 'author')).toBeNull();
    users.author = activeUser({ notificationPrefs: { pushLikes: false } });
    expect(await audience.forNotification('n1', 'author')).toBeNull();
    users.author = activeUser({ accountStatus: 'SUSPENDED' });
    expect(await audience.forNotification('n1', 'author')).toBeNull();
    users.author = activeUser();
    prisma.block.findFirst.mockResolvedValue({ blockerId: 'author' });
    expect(await audience.forNotification('n1', 'author')).toBeNull();
  });

  it('suppresses when the actor deleted their account', async () => {
    const { audience, users } = build();
    users.liker = activeUser({ deletedAt: new Date() });
    expect(await audience.forNotification('n1', 'author')).toBeNull();
  });

  it('community join request: only while pending and only to someone who can review it', async () => {
    const { audience, prisma } = build();
    prisma.notification.findUnique.mockResolvedValue({
      id: 'n2',
      recipientId: 'author',
      actorId: 'liker',
      type: 'COMMUNITY_JOIN_REQUEST',
      entityType: 'COMMUNITY',
      entityId: 'k1',
      metadata: {},
      readAt: null,
      deletedAt: null,
      updatedAt: new Date(),
    });
    prisma.community.findUnique.mockResolvedValue({
      ownerId: 'owner',
      deletedAt: null,
    });
    prisma.communityMember.findUnique.mockResolvedValue({ role: 'MODERATOR' });
    prisma.communityJoinRequest.findUnique.mockResolvedValue({
      status: 'PENDING',
    });
    expect(await audience.forNotification('n2', 'author')).not.toBeNull();

    prisma.communityJoinRequest.findUnique.mockResolvedValue({
      status: 'ACCEPTED',
    });
    expect(await audience.forNotification('n2', 'author')).toBeNull();

    prisma.communityJoinRequest.findUnique.mockResolvedValue({
      status: 'PENDING',
    });
    prisma.communityMember.findUnique.mockResolvedValue({ role: 'MEMBER' }); // demoted
    expect(await audience.forNotification('n2', 'author')).toBeNull();
  });

  it('activity invite: suppressed once cancelled or answered', async () => {
    const { audience, prisma } = build();
    prisma.notification.findUnique.mockResolvedValue({
      id: 'n3',
      recipientId: 'author',
      actorId: 'liker',
      type: 'ACTIVITY_INVITE',
      entityType: 'ACTIVITY',
      entityId: 'a1',
      metadata: {},
      readAt: null,
      deletedAt: null,
      updatedAt: new Date(),
    });
    prisma.activityInvitation.findUnique.mockResolvedValue({
      status: 'PENDING',
      activity: { deletedAt: null, status: 'OPEN' },
    });
    expect(await audience.forNotification('n3', 'author')).not.toBeNull();
    prisma.activityInvitation.findUnique.mockResolvedValue({
      status: 'PENDING',
      activity: { deletedAt: null, status: 'CANCELLED' },
    });
    expect(await audience.forNotification('n3', 'author')).toBeNull();
    prisma.activityInvitation.findUnique.mockResolvedValue({
      status: 'DECLINED',
      activity: { deletedAt: null, status: 'OPEN' },
    });
    expect(await audience.forNotification('n3', 'author')).toBeNull();
  });

  it('follow: suppressed after an unfollow', async () => {
    const { audience, prisma } = build();
    prisma.notification.findUnique.mockResolvedValue({
      id: 'n4',
      recipientId: 'author',
      actorId: 'liker',
      type: 'FOLLOW',
      entityType: null,
      entityId: 'liker',
      metadata: {},
      readAt: null,
      deletedAt: null,
      updatedAt: new Date(),
    });
    prisma.follow.findUnique.mockResolvedValue(null);
    expect(await audience.forNotification('n4', 'author')).toBeNull();
    prisma.follow.findUnique.mockResolvedValue({ followerId: 'liker' });
    expect(await audience.forNotification('n4', 'author')).toMatchObject({
      actorUsername: 'aarav',
    });
  });
});

describe('PushAudienceService.forMessage', () => {
  it('builds a burst from the unread count, routed by the public id', async () => {
    const { audience } = build();
    const found = await audience.forMessage('author', 'conv-1', 'liker');
    expect(found?.input).toMatchObject({
      routeId: 'pub-1',
      unread: 2,
      isGroup: false,
    });
  });

  it('suppresses when the recipient already read it (was viewing the chat)', async () => {
    const { audience, prisma } = build();
    prisma.conversationParticipant.findUnique.mockResolvedValue({
      unreadCount: 0,
      isMuted: false,
      leftAt: null,
      deletedAt: null,
      conversation: { id: 'conv-1', publicId: 'pub-1', name: null, type: 'DM' },
    });
    expect(await audience.forMessage('author', 'conv-1', 'liker')).toBeNull();
  });

  it('suppresses muted, left, non-participant and Instant Match conversations', async () => {
    const { audience, prisma } = build();
    const p = {
      unreadCount: 1,
      isMuted: false,
      leftAt: null,
      deletedAt: null,
      conversation: { id: 'conv-1', publicId: 'pub-1', name: null, type: 'DM' },
    };
    prisma.conversationParticipant.findUnique.mockResolvedValueOnce({
      ...p,
      isMuted: true,
    });
    expect(await audience.forMessage('author', 'conv-1', 'liker')).toBeNull();
    prisma.conversationParticipant.findUnique.mockResolvedValueOnce({
      ...p,
      leftAt: new Date(),
    });
    expect(await audience.forMessage('author', 'conv-1', 'liker')).toBeNull();
    prisma.conversationParticipant.findUnique.mockResolvedValueOnce(null);
    expect(await audience.forMessage('author', 'conv-1', 'liker')).toBeNull();
    prisma.conversationParticipant.findUnique.mockResolvedValueOnce({
      ...p,
      conversation: { ...p.conversation, type: 'INSTANT_MATCH' },
    });
    expect(await audience.forMessage('author', 'conv-1', 'liker')).toBeNull();
  });

  it('respects the messages category switch', async () => {
    const { audience, users } = build();
    users.author = activeUser({ notificationPrefs: { pushMessages: false } });
    expect(await audience.forMessage('author', 'conv-1', 'liker')).toBeNull();
  });
});

describe('PushAudienceService.forGroupRemoval', () => {
  const REMOVED_AT = '2026-10-28T10:00:00.000Z';
  const removed = (over: Record<string, unknown> = {}) => ({
    leftAt: new Date(REMOVED_AT),
    conversation: {
      id: 'conv-1',
      publicId: 'pub-1',
      name: 'Hostel B',
      type: 'GROUP',
    },
    ...over,
  });

  it('tells the member they were removed, routed by the public id', async () => {
    const { audience, prisma } = build();
    prisma.conversationParticipant.findUnique.mockResolvedValue(removed());
    expect(
      await audience.forGroupRemoval('author', 'conv-1', REMOVED_AT),
    ).toEqual({
      routeId: 'pub-1',
      conversationId: 'conv-1',
      groupName: 'Hostel B',
    });
  });

  it('suppresses once they are back in, or were removed again since (that removal pushes its own)', async () => {
    const { audience, prisma } = build();
    prisma.conversationParticipant.findUnique.mockResolvedValueOnce(
      removed({ leftAt: null }),
    );
    expect(
      await audience.forGroupRemoval('author', 'conv-1', REMOVED_AT),
    ).toBeNull();
    prisma.conversationParticipant.findUnique.mockResolvedValueOnce(
      removed({ leftAt: new Date('2026-10-28T11:00:00.000Z') }),
    );
    expect(
      await audience.forGroupRemoval('author', 'conv-1', REMOVED_AT),
    ).toBeNull();
  });

  it('suppresses it when the member had muted the group', async () => {
    const { audience, prisma } = build();
    prisma.conversationParticipant.findUnique.mockResolvedValueOnce(
      removed({ isMuted: true }),
    );
    expect(
      await audience.forGroupRemoval('author', 'conv-1', REMOVED_AT),
    ).toBeNull();
  });

  it('suppresses a non-participant, a non-group and a switched-off category', async () => {
    const { audience, prisma, users } = build();
    prisma.conversationParticipant.findUnique.mockResolvedValueOnce(null);
    expect(
      await audience.forGroupRemoval('author', 'conv-1', REMOVED_AT),
    ).toBeNull();
    prisma.conversationParticipant.findUnique.mockResolvedValueOnce(
      removed({
        conversation: { ...removed().conversation, type: 'DM' },
      }),
    );
    expect(
      await audience.forGroupRemoval('author', 'conv-1', REMOVED_AT),
    ).toBeNull();
    users.author = activeUser({ notificationPrefs: { pushMessages: false } });
    prisma.conversationParticipant.findUnique.mockResolvedValueOnce(removed());
    expect(
      await audience.forGroupRemoval('author', 'conv-1', REMOVED_AT),
    ).toBeNull();
  });
});

describe('PushAudienceService.forGroupJoinRequest', () => {
  const pending = (over: Record<string, unknown> = {}) => ({
    status: 'PENDING',
    expiresAt: null,
    conversation: {
      id: 'conv-1',
      publicId: 'pub-1',
      name: 'Hostel B',
      type: 'GROUP',
      status: 'ACTIVE',
    },
    ...over,
  });
  const reviewer = (over: Record<string, unknown> = {}) => ({
    role: 'ADMIN',
    leftAt: null,
    deletedAt: null,
    isMuted: false,
    ...over,
  });
  const setup = () => {
    const built = build();
    const requests = { findUnique: jest.fn().mockResolvedValue(pending()) };
    Object.assign(built.prisma, { conversationJoinRequest: requests });
    built.prisma.conversationParticipant.findUnique.mockResolvedValue(
      reviewer(),
    );
    return { ...built, requests };
  };

  it('names the requester and the group for a pending request', async () => {
    const { audience } = setup();
    expect(
      await audience.forGroupJoinRequest('author', 'conv-1', 'liker'),
    ).toEqual({
      routeId: 'pub-1',
      conversationId: 'conv-1',
      groupName: 'Hostel B',
      requesterName: 'Aarav',
    });
  });

  it('suppresses an answered or expired request, or a group that ended', async () => {
    const { audience, requests } = setup();
    requests.findUnique.mockResolvedValueOnce(null);
    expect(
      await audience.forGroupJoinRequest('author', 'conv-1', 'liker'),
    ).toBeNull();
    requests.findUnique.mockResolvedValueOnce(
      pending({ expiresAt: new Date(Date.now() - 1000) }),
    );
    expect(
      await audience.forGroupJoinRequest('author', 'conv-1', 'liker'),
    ).toBeNull();
    requests.findUnique.mockResolvedValueOnce(
      pending({
        conversation: { ...pending().conversation, status: 'Closed' },
      }),
    );
    expect(
      await audience.forGroupJoinRequest('author', 'conv-1', 'liker'),
    ).toBeNull();
  });

  it('suppresses a recipient no longer an admin, or one who muted the group', async () => {
    const { audience, prisma } = setup();
    prisma.conversationParticipant.findUnique.mockResolvedValueOnce(
      reviewer({ role: 'MEMBER' }),
    );
    expect(
      await audience.forGroupJoinRequest('author', 'conv-1', 'liker'),
    ).toBeNull();
    prisma.conversationParticipant.findUnique.mockResolvedValueOnce(
      reviewer({ isMuted: true }),
    );
    expect(
      await audience.forGroupJoinRequest('author', 'conv-1', 'liker'),
    ).toBeNull();
  });

  it('suppresses a request from someone either side has blocked', async () => {
    const { audience, prisma } = setup();
    prisma.block.findFirst.mockResolvedValueOnce({ blockerId: 'author' });
    expect(
      await audience.forGroupJoinRequest('author', 'conv-1', 'liker'),
    ).toBeNull();
  });
});
