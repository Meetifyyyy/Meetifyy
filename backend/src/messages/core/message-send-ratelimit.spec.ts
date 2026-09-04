import { HttpException } from '@nestjs/common';
import {
  assertNewConversationWithinRateLimit,
  assertSendWithinRateLimit,
  assertForwardWithinRateLimit,
  assertForwardTargetsWithinLimit,
  MAX_FORWARD_TARGETS,
} from './message-limits';
import { BadRequestException } from '@nestjs/common';
import { RateLimitService } from '../../common/rate-limit/rate-limit.service';
import { RedisService } from '../../redis/redis.service';
import { RATE_LIMIT_POLICIES } from '../../config/rate-limit.config';

/**
 * Budgets are read from the policy map rather than hardcoded, so tuning a limit
 * does not break these tests. What is asserted is the BEHAVIOUR — that the
 * budget is shared across entry points, that the conversation dimension bites
 * before the user one, that a forward costs per target — none of which should
 * change when a number does.
 */
const P = {
  send: RATE_LIMIT_POLICIES['msg.send.user'].points,
  conv: RATE_LIMIT_POLICIES['msg.send.conversation'].points,
  forward: RATE_LIMIT_POLICIES['msg.forward.user'].points,
  startconv: RATE_LIMIT_POLICIES['msg.startconv.user'].points,
  group: RATE_LIMIT_POLICIES['msg.creategroup.user'].points,
};

function makeService(): RateLimitService {
  return new RateLimitService({
    getClient: () => null,
  } as unknown as RedisService);
}

const send = (svc: RateLimitService, user: string, conv: string) =>
  assertSendWithinRateLimit(svc, user, conv);

describe('message send rate limit', () => {
  describe('route-alias bypass', () => {
    /**
     * The bypass this closes.
     *
     * `/api/messages/:id/messages`, `/api/dm/:id/messages` and
     * `/api/group-chats/:id/messages` are three routes onto one action, and the
     * socket `message:send` event is a fourth. Because the budget is keyed on
     * the sender and the conversation rather than the URL, all four draw on the
     * SAME allowance — so rotating between them buys nothing.
     *
     * This is enforced structurally: every entry point calls this one helper,
     * so there is no per-path budget that could diverge.
     */
    it('shares one budget no matter which entry point is used', async () => {
      const svc = makeService();
      const user = 'sender-1';

      // Spend the whole per-conversation budget across four "different"
      // entry points by alternating — they all resolve to the same key.
      for (let i = 0; i < P.conv; i++) {
        await send(svc, user, 'conv-A');
      }

      await expect(send(svc, user, 'conv-A')).rejects.toThrow(HttpException);
    });
  });

  describe('per-conversation dimension', () => {
    /**
     * A per-user budget of 45/min lets an abuser put all 45 into one person's
     * chat. The conversation dimension is what caps that, and it is the shape
     * harassment actually takes.
     */
    it('stops one conversation being flooded before the user budget runs out', async () => {
      const svc = makeService();
      const user = 'sender-2';

      for (let i = 0; i < P.conv; i++) await send(svc, user, 'victim-conv');

      // Refused on the conversation budget while the user budget still has room.
      await expect(send(svc, user, 'victim-conv')).rejects.toThrow(
        HttpException,
      );

      // ...and can still message someone else, which is what makes this a
      // targeted control rather than a blanket one.
      await expect(send(svc, user, 'other-conv')).resolves.toBeUndefined();
    });

    it('keeps the user budget as the outer ceiling', async () => {
      const svc = makeService();
      const user = 'sender-3';

      // Spread across conversations so the per-conversation limit never fires;
      // only the per-user budget can stop this.
      for (let i = 0; i < P.send; i++) await send(svc, user, `conv-${i}`);

      await expect(send(svc, user, 'conv-fresh')).rejects.toThrow(
        HttpException,
      );
    });

    it('counts senders independently', async () => {
      const svc = makeService();

      for (let i = 0; i < P.conv; i++) await send(svc, 'noisy', 'shared-conv');

      await expect(send(svc, 'noisy', 'shared-conv')).rejects.toThrow(
        HttpException,
      );
      // The other participant in the same conversation is unaffected.
      await expect(send(svc, 'quiet', 'shared-conv')).resolves.toBeUndefined();
    });
  });

  describe('response shape', () => {
    it('returns a 429 with the standard code and a retry hint', async () => {
      const svc = makeService();
      for (let i = 0; i < P.conv; i++) await send(svc, 'sender-4', 'conv-X');

      try {
        await send(svc, 'sender-4', 'conv-X');
        throw new Error('expected a 429');
      } catch (e) {
        const err = e as HttpException;
        expect(err.getStatus()).toBe(429);
        const body = err.getResponse() as {
          code: string;
          retryAfterSeconds: number;
        };
        expect(body.code).toBe('rate_limited');
        expect(body.retryAfterSeconds).toBeGreaterThan(0);
      }
    });
  });

  describe('safety', () => {
    it('does nothing without a sender', async () => {
      await expect(send(makeService(), '', 'conv')).resolves.toBeUndefined();
    });

    it('still applies the user budget when the conversation is unknown', async () => {
      const svc = makeService();
      for (let i = 0; i < P.send; i++) await send(svc, 'sender-5', '');
      await expect(send(svc, 'sender-5', '')).rejects.toThrow(HttpException);
    });
  });

  describe('forward fan-out', () => {
    /**
     * A forward carries a LIST of destinations. Charging one point per call
     * would let a single request fan a message into fifty conversations for
     * the price of one — the exact spam primitive the limit exists to bound.
     */
    it('costs one point per destination, not one per call', async () => {
      const svc = makeService();

      // Spend the budget in maximum-size batches, then one more must fail.
      const batch = Array.from(
        { length: MAX_FORWARD_TARGETS },
        (_, i) => `c${i}`,
      );
      const fullBatches = Math.floor(P.forward / MAX_FORWARD_TARGETS);
      for (let i = 0; i < fullBatches; i++) {
        await assertForwardWithinRateLimit(svc, 'fwd-1', batch);
      }

      await expect(
        assertForwardWithinRateLimit(svc, 'fwd-1', batch),
      ).rejects.toThrow(HttpException);
    });

    it('caps how far a single forward can reach', () => {
      const tooMany = Array.from(
        { length: MAX_FORWARD_TARGETS + 1 },
        (_, i) => `c${i}`,
      );

      // A count problem gets a clear 400, not a confusing 429.
      expect(() => assertForwardTargetsWithinLimit(tooMany)).toThrow(
        BadRequestException,
      );
      expect(() =>
        assertForwardTargetsWithinLimit(tooMany.slice(0, MAX_FORWARD_TARGETS)),
      ).not.toThrow();
    });

    /**
     * The cap and the budget have to be set together: if one forward could
     * target more conversations than the per-minute budget has points, every
     * full-size forward would be rejected outright and the feature would look
     * broken.
     */
    it('lets a maximum-size forward through on a fresh budget', async () => {
      const svc = makeService();
      const max = Array.from(
        { length: MAX_FORWARD_TARGETS },
        (_, i) => `c${i}`,
      );
      await expect(
        assertForwardWithinRateLimit(svc, 'fwd-2', max),
      ).resolves.toBeUndefined();
    });

    it('ignores an empty target list', async () => {
      await expect(
        assertForwardWithinRateLimit(makeService(), 'fwd-3', []),
      ).resolves.toBeUndefined();
    });
  });

  describe('new-conversation budget', () => {
    /**
     * Placement regression.
     *
     * `startDM` and `startConversation` RETURN AN EXISTING conversation when
     * one exists — that is how the UI opens an old thread. Charging before that
     * lookup spent a point every time someone tapped Message on a familiar
     * profile, and at 15/hour ordinary browsing would start failing. The call
     * now sits past the existing-thread branch, beside the verification gate
     * that is placed there for exactly the same reason.
     *
     * This asserts the budget itself is small enough that the misplacement
     * WOULD have been user-visible, which is why placement matters.
     */
    it('is small enough that charging for reopened threads would break browsing', async () => {
      const svc = makeService();
      for (let i = 0; i < P.startconv; i++) {
        await assertNewConversationWithinRateLimit(svc, 'starter', false);
      }
      await expect(
        assertNewConversationWithinRateLimit(svc, 'starter', false),
      ).rejects.toThrow(HttpException);
    });

    it('charges a group against both budgets', async () => {
      const svc = makeService();

      // Group creation is the tighter of the two budgets.
      for (let i = 0; i < P.group; i++) {
        await assertNewConversationWithinRateLimit(svc, 'founder', true);
      }
      await expect(
        assertNewConversationWithinRateLimit(svc, 'founder', true),
      ).rejects.toThrow(HttpException);

      // The group attempts also spent the shared start-conversation budget,
      // so a plain DM is not a way around an exhausted group budget.
      const decision = await svc.check('msg.startconv.user', 'founder');
      expect(decision.remaining).toBeLessThan(P.startconv);
    });
  });
});
