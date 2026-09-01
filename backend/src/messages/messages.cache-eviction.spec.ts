import { MessagesService } from './messages.service';

/**
 * Conversation-cache eviction on an account-lifecycle change.
 *
 * The conversation list is cached per viewer for 60s and carries the other
 * person's name, avatar and `targetUserUnavailable`. Without eviction a partner
 * who reloads inside that window keeps seeing a deleted account's real name and
 * photo, and an enabled composer.
 */
describe('MessagesService — conversation-cache eviction on lifecycle change', () => {
  const USER_ID = 'gone-1';

  let service: MessagesService;
  let prisma: any;
  let evicted: string[];
  let partners: string[];

  beforeEach(() => {
    partners = ['p1', 'p2', 'p3'];
    evicted = [];

    prisma = {
      conversationParticipant: {
        // Honours the keyset cursor, so a fake cannot make the paging look
        // correct by returning everything on the first call.
        findMany: jest.fn(async ({ where, take }: any) => {
          const after = where.userId?.gt;
          const page = partners
            .filter((id) => (after ? id > after : true))
            .sort()
            .slice(0, take);
          return page.map((userId) => ({ userId }));
        }),
      },
    };

    service = Object.create(MessagesService.prototype) as MessagesService;
    Object.assign(service, {
      prisma,
      logger: { log: jest.fn(), warn: jest.fn() },
      invalidateUserConversationsCache: jest.fn(async (ids: string[]) => {
        evicted.push(...ids);
      }),
    });
  });

  it('evicts the deleting user and every conversation partner', async () => {
    await service.handleAccountLifecycleChanged({ data: { userId: USER_ID } });
    expect(evicted).toEqual([USER_ID, 'p1', 'p2', 'p3']);
  });

  it('pages past the batch size instead of silently truncating', async () => {
    // The bug this pins down: a fixed `take: 500` looks safe until an account
    // with more partners than that deletes itself, and the overflow keeps
    // seeing a real name — a privacy bug whose trigger is "unusually popular
    // user", i.e. precisely the account where it matters most.
    partners = Array.from({ length: 1200 }, (_, i) =>
      `p${String(i).padStart(5, '0')}`,
    );

    await service.handleAccountLifecycleChanged({ data: { userId: USER_ID } });

    expect(evicted).toHaveLength(1 + 1200);
    expect(new Set(evicted).size).toBe(1 + 1200); // no page overlaps
    expect(evicted).toContain('p01199'); // the last one is not lost
  });

  it('accepts the payload shape the domain-event bus actually delivers', async () => {
    // The emitter wraps the payload as `{ type, data }` locally but listeners
    // elsewhere receive the bare object; both shapes must resolve.
    await service.handleAccountLifecycleChanged({ userId: USER_ID });
    expect(evicted).toContain(USER_ID);
  });

  it('ignores a payload with no user id rather than evicting nothing in a loop', async () => {
    await service.handleAccountLifecycleChanged({});
    expect(evicted).toEqual([]);
    expect(prisma.conversationParticipant.findMany).not.toHaveBeenCalled();
  });

  it('never lets a cache failure escape — Postgres is the source of truth', async () => {
    prisma.conversationParticipant.findMany = jest.fn(async () => {
      throw new Error('redis down');
    });
    await expect(
      service.handleAccountLifecycleChanged({ data: { userId: USER_ID } }),
    ).resolves.toBeUndefined();
  });
});
