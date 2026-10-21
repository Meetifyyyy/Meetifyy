import 'reflect-metadata';
import { RealtimeGateway } from './realtime.gateway';
import { createVerificationAccessMock } from '../common/verification/testing/verification-access.mock';
import { createLegalConsentMock } from '../common/legal/testing/legal-consent.mock';
import { allowAllRateLimit } from '../common/rate-limit/testing/rate-limit.mock';
import { stub } from '../common/testing/stub';
import type { SupabaseService } from '../supabase/supabase.service';
import type { MessagesService } from '../messages/messages.service';
import type { PresenceService } from '../presence/presence.service';
import type { InstantMatchService } from '../instant-match/instant-match.service';
import type { InstantMatchRateLimiter } from '../instant-match/instant-match.rate-limiter';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';
import type { ActivityAuthorizationService } from '../activities/activity-authorization.service';
import type { BlocksService } from '../users/blocks.service';
import type { PushDispatcherService } from '../push/push-dispatcher.service';
import type { MessagePushJob } from '../push/push.types';

/**
 * A message sent over the socket (the app's main send path) is pushed to the
 * same unmuted recipients the alert flag uses, after it committed, keyed to
 * the internal conversation id, never to the sender, and never for Instant
 * Match chats.
 */
function build(message: Record<string, unknown>) {
  const enqueueForMessage = jest.fn<
    void,
    [MessagePushJob | null | undefined]
  >();
  const sendMessage = jest.fn().mockResolvedValue(message);
  const gateway = new RealtimeGateway(
    stub<SupabaseService>(),
    stub<MessagesService>({ sendMessage }),
    stub<PresenceService>(),
    stub<InstantMatchService>(),
    stub<InstantMatchRateLimiter>({ consume: () => true }),
    stub<PrismaService>(),
    stub<RedisService>({ getClient: jest.fn() }),
    stub<ActivityAuthorizationService>(),
    stub<BlocksService>(),
    createVerificationAccessMock(),
    allowAllRateLimit(),
    createLegalConsentMock(),
    undefined,
    stub<PushDispatcherService>({ enqueueForMessage }),
  );
  gateway.server = stub<RealtimeGateway['server']>({
    to: () => ({ emit: jest.fn() }),
  });
  const socket = stub<Parameters<RealtimeGateway['handleSendMessage']>[0]>({
    id: 'sock-a',
    data: { userId: 'alice', userName: 'alice' },
    to: () => ({ emit: jest.fn() }),
    emit: jest.fn(),
  });
  return { gateway, socket, enqueueForMessage, sendMessage };
}

const payload = {
  tempId: 't1',
  clientId: 't1',
  conversationId: 'p1',
  text: 'hi',
  mentions: [],
};

describe('socket message:send push hand-off', () => {
  it('enqueues one push per unmuted recipient, never the sender', async () => {
    const { gateway, socket, enqueueForMessage } = build({
      id: 'm1',
      internalId: 'conv-1',
      isInstantMatch: false,
      recipientIds: ['alice', 'bob', 'carol'],
      unmutedRecipientIds: ['bob'],
    });
    const ack = await gateway.handleSendMessage(socket, payload);
    expect(ack).toMatchObject({ status: 'ok' });
    expect(enqueueForMessage).toHaveBeenCalledTimes(1);
    expect(enqueueForMessage).toHaveBeenCalledWith({
      recipientId: 'bob',
      conversationId: 'conv-1',
      senderId: 'alice',
    });
  });

  it('never pushes Instant Match messages', async () => {
    const { gateway, socket, enqueueForMessage } = build({
      id: 'm1',
      internalId: 'conv-1',
      isInstantMatch: true,
      recipientIds: ['bob'],
      unmutedRecipientIds: ['bob'],
    });
    await gateway.handleSendMessage(socket, payload);
    expect(enqueueForMessage).not.toHaveBeenCalled();
  });

  it('a failed send pushes nothing', async () => {
    const { gateway, socket, enqueueForMessage, sendMessage } = build({});
    sendMessage.mockRejectedValue(new Error('not a participant'));
    const ack = await gateway.handleSendMessage(socket, payload);
    expect(ack).toMatchObject({ status: 'error' });
    expect(enqueueForMessage).not.toHaveBeenCalled();
  });
});
