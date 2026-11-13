import type { RateLimitService } from '../common/rate-limit/rate-limit.service';
import { stub } from '../common/testing/stub';
import { buildGateway, fakeSocket } from './testing/gateway.fixture';

/**
 * Instant Match socket events touched by the E-7 inspection: the chat-state
 * read and the queue cancel now have budgets (IM-20), and reading the roster
 * is what subscribes a socket to `queue:changed` (IM-17).
 */
describe('RealtimeGateway — Instant Match events', () => {
  const decision = (allowed: boolean) => ({
    policy: allowed ? 'global.user' : 'im.chatstate.user',
    allowed,
    remaining: allowed ? 10 : 0,
    resetSeconds: 42,
    limit: 30,
    windowSeconds: 60,
    shadowed: false,
    degraded: false,
  });

  const setup = (allowed: boolean) => {
    const consumeAll = jest.fn(
      (_policies: Array<{ policy: string; identifier: string }>) =>
        Promise.resolve(decision(allowed)),
    );
    const instantMatch = {
      cancelQueue: jest.fn(() => Promise.resolve()),
      getChatStateFor: jest.fn(() => Promise.resolve(null)),
      getSearchingNow: jest.fn(() => Promise.resolve([])),
    };
    const gateway = buildGateway({
      instantMatch,
      rateLimit: stub<RateLimitService>({ consumeAll }),
    });
    const join = jest.fn();
    const client = fakeSocket({ data: { userId: 'u1' }, join });
    return { gateway, instantMatch, consumeAll, client, join };
  };

  it.each([
    ['queue:cancel', 'handleQueueCancel', 'cancelQueue', 'im.cancel.user'],
    [
      'instant_match:chat_state',
      'handleInstantMatchChatState',
      'getChatStateFor',
      'im.chatstate.user',
    ],
  ] as const)(
    '%s is limited per user',
    async (_event, handler, method, policy) => {
      const allowed = setup(true);
      await allowed.gateway[handler](allowed.client);
      expect(allowed.consumeAll).toHaveBeenCalledWith([
        { policy, identifier: 'u1' },
      ]);
      expect(allowed.instantMatch[method]).toHaveBeenCalled();

      const refused = setup(false);
      await expect(
        refused.gateway[handler](refused.client),
      ).resolves.toMatchObject({
        status: 'error',
        code: 429,
        retryAfterSeconds: 42,
      });
      expect(refused.instantMatch[method]).not.toHaveBeenCalled();
    },
  );

  it('reading the roster subscribes the socket to queue changes', async () => {
    const { gateway, client, join } = setup(true);
    await expect(gateway.handleQueueList(client)).resolves.toMatchObject({
      status: 'ok',
    });
    expect(join).toHaveBeenCalledWith('im:roster');
  });
});
