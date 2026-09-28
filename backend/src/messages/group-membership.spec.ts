import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { GroupChatsService } from './group-chats/group-chats.service';

/**
 * Adding, removing and leaving are group actions (pending item A12, and what
 * tracing it found).
 *
 * The routes resolved any conversation id and checked only a role, but the
 * creator of a DM is its OWNER. So, through `POST|DELETE /:id/members` and
 * `POST /:id/leave` on either controller:
 *   - a DM's creator could remove the other person, or pull a third one in;
 *   - an Instant Match chat could be given extra members;
 *   - add only asked whether the requester had ANY participant row, and its
 *     upsert clears `leftAt` and sets role MEMBER — so a removed member could
 *     re-add themselves, and any member could "add" the owner and demote them.
 * No client offers any of these: leave and add are rendered for groups only,
 * and Instant Match leaves over its socket.
 *
 * Both services carry their own copy of these methods; both are driven here
 * against one in-memory store.
 */
type Participant = {
  userId: string;
  conversationId: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
  leftAt: Date | null;
  deletedAt: Date | null;
  joinedAt: Date;
};
type Key = {
  userId_conversationId: { userId: string; conversationId: string };
};
type Where = Partial<Record<keyof Participant, unknown>>;

function makeStore() {
  const conversations = new Map<
    string,
    { id: string; type: string; ownerId: string | null }
  >();
  const participants = new Map<string, Participant>();
  const k = (w: Key) =>
    `${w.userId_conversationId.userId}|${w.userId_conversationId.conversationId}`;
  const matches = (p: Participant, where: Where) =>
    Object.entries(where).every(([field, cond]) => {
      const value = p[field as keyof Participant];
      if (cond && typeof cond === 'object' && 'not' in cond)
        return value !== cond.not;
      return value === cond;
    });
  const clone = (p: Participant | undefined) => (p ? { ...p } : null);

  const prisma = {
    conversation: {
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(conversations.get(where.id) ?? null),
      update: ({
        where,
        data,
      }: {
        where: { id: string };
        data: { ownerId: string };
      }) => {
        const c = conversations.get(where.id)!;
        Object.assign(c, data);
        return Promise.resolve({ ...c });
      },
    },
    conversationParticipant: {
      findUnique: ({ where }: { where: Key }) =>
        Promise.resolve(clone(participants.get(k(where)))),
      findMany: ({ where }: { where: Where }) =>
        Promise.resolve(
          [...participants.values()].filter((p) => matches(p, where)),
        ),
      findFirst: ({ where }: { where: Where }) =>
        Promise.resolve(
          clone(
            [...participants.values()]
              .filter((p) => matches(p, where))
              .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime())[0],
          ),
        ),
      update: ({ where, data }: { where: Key; data: Partial<Participant> }) => {
        const p = participants.get(k(where))!;
        Object.assign(p, data);
        return Promise.resolve({ ...p });
      },
      upsert: ({
        where,
        update,
        create,
      }: {
        where: Key;
        update: Partial<Participant>;
        create: Pick<Participant, 'userId' | 'conversationId' | 'role'>;
      }) => {
        const existing = participants.get(k(where));
        if (existing) Object.assign(existing, update);
        else
          participants.set(k(where), {
            ...create,
            leftAt: null,
            deletedAt: null,
            joinedAt: new Date(),
          });
        return Promise.resolve({ ...participants.get(k(where))! });
      },
    },
    $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
  };

  let clock = 0;
  const addConversation = (
    id: string,
    type: string,
    members: [string, Participant['role']][],
  ) => {
    conversations.set(id, {
      id,
      type,
      ownerId: members.find(([, r]) => r === 'OWNER')?.[0] ?? null,
    });
    for (const [userId, role] of members)
      participants.set(`${userId}|${id}`, {
        userId,
        conversationId: id,
        role,
        leftAt: null,
        deletedAt: null,
        joinedAt: new Date(2026, 0, 1, 0, 0, clock++),
      });
  };
  const member = (userId: string, conversationId: string) =>
    participants.get(`${userId}|${conversationId}`);
  return { prisma, addConversation, member };
}

type MemberOps = Pick<
  MessagesService,
  'addGroupMember' | 'removeGroupMember' | 'leaveGroup'
>;

const services: [string, (prisma: unknown) => MemberOps][] = [
  ['MessagesService', (prisma) => build(MessagesService.prototype, prisma)],
  ['GroupChatsService', (prisma) => build(GroupChatsService.prototype, prisma)],
];

function build<T extends object>(proto: T, prisma: unknown): T {
  const service = Object.create(proto) as T;
  Object.assign(service, {
    prisma,
    resolveConversationId: (id: string) => Promise.resolve(id),
    invalidateUserConversationsCache: () => Promise.resolve(),
    verificationAccess: { assertUsersEligible: () => Promise.resolve() },
    studentYearPolicy: { assertCanInteract: () => Promise.resolve() },
    blocksService: { isBlocked: () => Promise.resolve(false) },
  });
  return service;
}

describe.each(services)('%s — group membership routes', (_name, make) => {
  let store: ReturnType<typeof makeStore>;
  let service: MemberOps;

  beforeEach(() => {
    store = makeStore();
    service = make(store.prisma);
    store.addConversation('dm', 'DM', [
      ['alice', 'OWNER'],
      ['bob', 'MEMBER'],
    ]);
    store.addConversation('im', 'INSTANT_MATCH', [
      ['alice', 'MEMBER'],
      ['bob', 'MEMBER'],
    ]);
    store.addConversation('grp', 'GROUP', [
      ['owner', 'OWNER'],
      ['admin', 'ADMIN'],
      ['member', 'MEMBER'],
    ]);
  });

  describe('refuse anything that is not a group', () => {
    it("a DM's creator cannot remove the other person", async () => {
      await expect(
        service.removeGroupMember('dm', 'alice', 'bob'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(store.member('bob', 'dm')!.leftAt).toBeNull();
    });

    it('a DM cannot be left through the group route', async () => {
      await expect(service.leaveGroup('dm', 'bob')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(store.member('bob', 'dm')!.leftAt).toBeNull();
    });

    it.each(['dm', 'im'])(
      'nobody can be added to a %s conversation',
      async (id) => {
        await expect(
          service.addGroupMember(id, 'alice', 'carol'),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(store.member('carol', id)).toBeUndefined();
      },
    );
  });

  describe('adding needs an active member, and changes nobody already in', () => {
    it('a removed member cannot re-add themselves', async () => {
      await service.removeGroupMember('grp', 'admin', 'member');
      await expect(
        service.addGroupMember('grp', 'member', 'member'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(store.member('member', 'grp')!.leftAt).not.toBeNull();
    });

    it('a member who left cannot add anyone', async () => {
      await service.leaveGroup('grp', 'member');
      await expect(
        service.addGroupMember('grp', 'member', 'carol'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(store.member('carol', 'grp')).toBeUndefined();
    });

    it("'adding' the owner or an admin does not demote them", async () => {
      await expect(
        service.addGroupMember('grp', 'member', 'owner'),
      ).resolves.toEqual({ success: true, alreadyMember: true });
      await service.addGroupMember('grp', 'member', 'admin');
      expect(store.member('owner', 'grp')!.role).toBe('OWNER');
      expect(store.member('admin', 'grp')!.role).toBe('ADMIN');
    });
  });

  describe('groups work as before', () => {
    it('an active member adds someone new', async () => {
      await expect(
        service.addGroupMember('grp', 'member', 'carol'),
      ).resolves.toEqual({
        success: true,
        alreadyMember: false,
      });
      expect(store.member('carol', 'grp')).toMatchObject({
        role: 'MEMBER',
        leftAt: null,
      });
    });

    it('someone who left can be added back by a member', async () => {
      await service.leaveGroup('grp', 'member');
      await service.addGroupMember('grp', 'admin', 'member');
      expect(store.member('member', 'grp')!.leftAt).toBeNull();
    });

    it('an admin removes a member, and a member leaves', async () => {
      await service.removeGroupMember('grp', 'admin', 'member');
      expect(store.member('member', 'grp')!.leftAt).not.toBeNull();
      await service.leaveGroup('grp', 'admin');
      expect(store.member('admin', 'grp')!.leftAt).not.toBeNull();
    });

    it('an owner who leaves hands the group to the oldest admin', async () => {
      await service.leaveGroup('grp', 'owner');
      expect(store.member('admin', 'grp')!.role).toBe('OWNER');
    });
  });
});
