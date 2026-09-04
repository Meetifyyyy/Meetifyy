import { BlocksService } from './blocks.service';

/**
 * The block cache's pub/sub subscription, and the fact that ONE handler is
 * enough for every instance of the service.
 *
 * BlocksService is named in the `providers` array of nine modules, so Nest
 * builds nine of it. That is why its caches are `static` — one Map, shared by
 * all of them. The subscription was not deduplicated the same way, so each
 * instance registered its own 'message' handler and all nine then did the
 * identical work on that one shared Map: the second through ninth deleted keys
 * the first had already deleted.
 *
 * These tests pin the property that made removing them safe — a single handler
 * clears the cache that EVERY instance reads — so a future change cannot
 * quietly turn the deduplication into lost invalidations.
 */
describe('BlocksService cross-instance subscription', () => {
  let subscribe: jest.Mock;
  let messageHandlers: ((channel: string, message: string) => void)[];
  let redisService: any;
  let prisma: any;
  let instances: BlocksService[];

  const CHANNEL = 'meetifyy:blocks_invalidate';

  const makeInstance = () => {
    const instance = new BlocksService(prisma, redisService);
    instance.onModuleInit();
    instances.push(instance);
    return instance;
  };

  beforeEach(async () => {
    messageHandlers = [];
    subscribe = jest.fn();
    instances = [];

    redisService = {
      getClient: () => null,
      getPubClient: () => null,
      getSubClient: () => ({
        subscribe,
        on: jest.fn((event: string, handler: any) => {
          if (event === 'message') messageHandlers.push(handler);
        }),
      }),
    };

    prisma = {
      block: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ blockerId: 'me', blockedId: 'them' }]),
      },
    };

    // The cache is static, so it outlives each test's instances. Drop the key
    // these tests use rather than letting one test's entry answer the next
    // test's read. (This instance is deliberately not initialised — it must
    // not register a handler.)
    await new BlocksService(prisma, undefined).invalidateBlockCache(
      'me',
      'them',
    );
  });

  afterEach(() => {
    // Releases the module-level subscription guard.
    for (const instance of instances) instance.onModuleDestroy();
  });

  const deliver = (userIds: string[]) => {
    for (const handler of messageHandlers) {
      handler(CHANNEL, JSON.stringify(userIds));
    }
  };

  it('registers exactly one message handler however many instances exist', () => {
    // One per module that lists BlocksService in its providers.
    for (let i = 0; i < 9; i++) makeInstance();

    expect(messageHandlers).toHaveLength(1);
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledWith(CHANNEL, expect.any(Function));
  });

  it('shares one cache across instances, so a read on one is served to another', async () => {
    const a = makeInstance();
    const b = makeInstance();

    await a.getExcludedUserIds('me');
    await b.getExcludedUserIds('me');

    // The second instance never queried: the cache is static.
    expect(prisma.block.findMany).toHaveBeenCalledTimes(1);
  });

  it('clears the cache for EVERY instance from that single handler', async () => {
    const a = makeInstance();
    const b = makeInstance();

    await a.getExcludedUserIds('me');
    expect(prisma.block.findMany).toHaveBeenCalledTimes(1);

    // A block made on another replica.
    deliver(['me']);

    // Both instances must now miss and re-read. This is the guarantee the
    // eight removed duplicate handlers were not adding to — they deleted keys
    // that the surviving handler had already deleted from the same Map.
    prisma.block.findMany.mockResolvedValue([]);
    await b.getExcludedUserIds('me');
    expect(prisma.block.findMany).toHaveBeenCalledTimes(2);

    await a.getExcludedUserIds('me');
    // Served from the cache b just repopulated — still one shared Map.
    expect(prisma.block.findMany).toHaveBeenCalledTimes(2);
    expect(await a.getExcludedUserIds('me')).toEqual([]);
  });

  it('ignores other channels and malformed payloads', async () => {
    const a = makeInstance();
    await a.getExcludedUserIds('me');

    for (const handler of messageHandlers) {
      handler('meetifyy:something_else', JSON.stringify(['me']));
      handler(CHANNEL, 'not json');
    }

    await a.getExcludedUserIds('me');
    expect(prisma.block.findMany).toHaveBeenCalledTimes(1);
  });

  it('works with no Redis at all — no subscription, cache still functional', async () => {
    redisService = undefined;
    const a = makeInstance();

    expect(messageHandlers).toHaveLength(0);
    expect(await a.getExcludedUserIds('me')).toEqual(['them']);
  });
});
