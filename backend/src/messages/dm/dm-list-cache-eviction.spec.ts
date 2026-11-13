import { DmService } from './dm.service';
import { conversationListFirstPageKeys } from '../conversation-list-cache';

/**
 * Writes through the `/api/dm` routes clear the cached conversation list.
 *
 * The unified list (MessagesService) is cached per viewer and includes DMs,
 * but DmService inherited the base class's eviction, which was a no-op: a
 * read, mute, pin, clear or delete through these routes left that list stale
 * until the cache expired. The base class now evicts the first-page keys
 * through the Redis service every subclass already holds.
 */
describe('DmService — conversation list cache eviction', () => {
  const ME = 'me-1';
  const CONV = 'conv-1';

  let service: DmService;
  let del: jest.Mock<Promise<number>, string[]>;
  let redisAvailable: boolean;

  beforeEach(() => {
    del = jest.fn((..._keys: string[]) => Promise.resolve(1));
    redisAvailable = true;
    service = Object.create(DmService.prototype) as DmService;
    Object.assign(service, {
      redisService: {
        getClient: () => (redisAvailable ? { del } : null),
      },
      prisma: {
        conversationParticipant: {
          updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
        },
      },
      domainEventService: { emit: jest.fn(() => Promise.resolve()) },
      resolveConversationId: jest.fn(() => Promise.resolve(CONV)),
    });
  });

  const deletedKeys = () => del.mock.calls.flat();

  it('deletes the first page of both list variants for every user named', async () => {
    await service.invalidateUserConversationsCache([ME, 'them']);
    expect(del).toHaveBeenCalledTimes(1);
    expect(deletedKeys()).toEqual([
      ...conversationListFirstPageKeys(ME),
      ...conversationListFirstPageKeys('them'),
    ]);
  });

  it.each([
    ['mute', (s: DmService) => s.muteConversation(CONV, ME, true)],
    ['pin', (s: DmService) => s.pinConversation(CONV, ME, true)],
    ['clear', (s: DmService) => s.clearChatForUser(CONV, ME)],
    ['delete', (s: DmService) => s.deleteConversationForUser(CONV, ME)],
  ])('evicts the caller after a %s', async (_name, write) => {
    await write(service);
    expect(deletedKeys()).toEqual(conversationListFirstPageKeys(ME));
  });

  it('does nothing without Redis, and nothing for an empty list', async () => {
    redisAvailable = false;
    await service.invalidateUserConversationsCache([ME]);
    redisAvailable = true;
    await service.invalidateUserConversationsCache([]);
    await service.invalidateUserConversationsCache();
    expect(del).not.toHaveBeenCalled();
  });

  it('never fails the write when the eviction fails', async () => {
    del.mockImplementation(() => Promise.reject(new Error('redis down')));
    await expect(
      service.invalidateUserConversationsCache([ME]),
    ).resolves.toBeUndefined();
    await expect(service.muteConversation(CONV, ME, true)).resolves.toEqual({
      success: true,
      muted: true,
    });
  });
});
