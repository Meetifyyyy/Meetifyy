import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import { SendMessageDto } from '../messages/core/dto/send-message.dto';
import { createVerificationAccessMock } from '../common/verification/testing/verification-access.mock';
import { createStudentYearPolicyMock } from '../common/student-year/testing/student-year-policy.mock';
import { createLegalConsentMock } from '../common/legal/testing/legal-consent.mock';
import { allowAllRateLimit } from '../common/rate-limit/testing/rate-limit.mock';

/**
 * Conversation-scoped socket events: who may cause them, and what they accept.
 *
 * Typing indicators, delivery receipts and read marks used to be emitted into
 * whatever conversation the client named, participant or not, and the named id
 * went unvalidated into a Prisma `where` (an object there is a filter, not an
 * id). `message:send` forwarded its whole payload unvalidated, although the
 * HTTP route validates the same fields. Two presence handlers no client has
 * ever called took unbounded id lists.
 */
const ALICE = 'alice'; // a participant of c1
const MALLORY = 'mallory'; // not a participant of anything
const CONV = { id: 'c1', publicId: 'p1' };

type Emit = jest.Mock<void, [string, unknown]>;
type ConvFindFirst = jest.Mock<Promise<typeof CONV | null>, [unknown]>;

function build() {
  const emitted: { room: string; event: string; payload: unknown }[] = [];
  const findFirst: ConvFindFirst = jest.fn((args: unknown) => {
    // Resolves only when the caller is an active participant: the query must
    // carry the membership condition, not merely the id.
    const text = JSON.stringify(args);
    return Promise.resolve(
      text.includes(`"userId":"${ALICE}"`) && text.includes('participants')
        ? CONV
        : null,
    );
  });
  const markAsRead = jest.fn().mockResolvedValue({ success: true });
  const sendMessage = jest.fn().mockResolvedValue({
    id: 'm1',
    recipientIds: [],
    unmutedRecipientIds: [],
  });

  const gateway = new RealtimeGateway(
    ...([
      { isConfigured: true, client: { auth: { getUser: jest.fn() } } },
      { markAsRead, sendMessage },
      { setOnline: jest.fn(), setOffline: jest.fn() },
      {},
      // The per-process limiter for ephemeral events: always allows here.
      { consume: () => true },
      {
        conversation: { findFirst },
        conversationParticipant: { findMany: jest.fn().mockResolvedValue([]) },
      },
      { getClient: jest.fn() },
      {},
      {},
      { getExcludedUserIds: jest.fn().mockResolvedValue([]) },
      createVerificationAccessMock(),
      createStudentYearPolicyMock(),
      allowAllRateLimit(),
      createLegalConsentMock(),
      undefined,
    ] as unknown as ConstructorParameters<typeof RealtimeGateway>),
  );
  // Records one entry per room, whether the gateway names one room or several.
  gateway.server = {
    to: (room: string | string[]) => ({
      emit: (event: string, payload: unknown) => {
        for (const r of ([] as string[]).concat(room))
          emitted.push({ room: r, event, payload });
      },
    }),
  } as unknown as RealtimeGateway['server'];

  return { gateway, emitted, findFirst, markAsRead, sendMessage };
}

/** A connected socket for `userId`: the gateway keeps identity in `socket.data`. */
function socketFor(userId: string) {
  const emit: Emit = jest.fn<void, [string, unknown]>();
  return {
    id: `sock-${userId}`,
    data: { userId, userName: userId },
    rooms: new Set<string>(),
    emit,
    join: jest.fn(),
    leave: jest.fn(),
    to: () => ({ emit: jest.fn() }),
  } as unknown as Parameters<RealtimeGateway['handleTypingStart']>[0];
}

const rooms = (e: { room: string }[]) => e.map((x) => x.room).sort();

describe('conversation events: only participants may cause them', () => {
  it('relays typing from a participant to both room aliases', async () => {
    const { gateway, emitted } = build();
    await gateway.handleTypingStart(socketFor(ALICE), { conversationId: 'p1' });
    expect(rooms(emitted)).toEqual(['conv_c1', 'conv_p1']);
    expect(emitted[0].payload).toMatchObject({ userId: ALICE });
  });

  it('drops typing from someone who is not in the conversation', async () => {
    const { gateway, emitted } = build();
    await gateway.handleTypingStart(socketFor(MALLORY), {
      conversationId: 'c1',
    });
    await gateway.handleTypingStop(socketFor(MALLORY), {
      conversationId: 'c1',
    });
    expect(emitted).toEqual([]);
  });

  it('drops a delivery receipt from a non-participant, on both event names', async () => {
    const { gateway, emitted } = build();
    const data = { conversationId: 'c1', messageId: 'm1' };
    await gateway.handleMessageDelivered(socketFor(MALLORY), data);
    await gateway.handleMessageReceived(socketFor(MALLORY), data);
    expect(emitted).toEqual([]);
  });

  it("relays a participant's delivery receipt, attributed to them", async () => {
    const { gateway, emitted } = build();
    await gateway.handleMessageDelivered(socketFor(ALICE), {
      conversationId: 'c1',
      messageId: 'm1',
    });
    expect(rooms(emitted)).toEqual(['conv_c1', 'conv_p1']);
    expect(emitted[0].payload).toMatchObject({
      deliveredTo: ALICE,
      messageId: 'm1',
    });
  });

  it('neither marks nor announces a read by a non-participant', async () => {
    const { gateway, emitted, markAsRead } = build();
    await gateway.handleMarkSeen(socketFor(MALLORY), { conversationId: 'c1' });
    await gateway.handleMessagesSeen(socketFor(MALLORY), {
      conversationId: 'c1',
    });
    expect(markAsRead).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
  });

  it("marks and announces a participant's read", async () => {
    const { gateway, emitted, markAsRead } = build();
    await gateway.handleMarkSeen(socketFor(ALICE), { conversationId: 'p1' });
    expect(markAsRead).toHaveBeenCalledWith('c1', ALICE);
    expect(emitted.map((e) => e.event)).toContain('conversation:seen');
  });
});

describe('conversation events: ids are validated before any lookup', () => {
  const hostile: unknown[] = [{ not: '' }, ['c1'], 42, '', 'x'.repeat(500)];

  it.each(hostile)(
    'ignores conversationId %j without touching the database',
    async (id) => {
      const { gateway, emitted, findFirst, markAsRead } = build();
      const data = { conversationId: id, messageId: 'm1' } as unknown as {
        conversationId: string;
        messageId: string;
      };
      await gateway.handleTypingStart(socketFor(ALICE), data);
      await gateway.handleMessageDelivered(socketFor(ALICE), data);
      await gateway.handleMarkSeen(socketFor(ALICE), data);
      expect(findFirst).not.toHaveBeenCalled();
      expect(markAsRead).not.toHaveBeenCalled();
      expect(emitted).toEqual([]);
    },
  );
});

describe('message:send validates like the HTTP route', () => {
  const valid = {
    tempId: 't1',
    clientId: 't1',
    conversationId: 'c1',
    text: 'hi',
    mentions: [],
  };

  it('accepts the payload the client actually sends', async () => {
    const { gateway, sendMessage } = build();
    const ack = await gateway.handleSendMessage(socketFor(ALICE), valid);
    expect(ack).toMatchObject({ status: 'ok', tempId: 't1' });
    expect(sendMessage).toHaveBeenCalledWith(
      ALICE,
      'c1',
      expect.objectContaining({ text: 'hi', clientId: 't1' }),
    );
  });

  it.each([
    ['text that is not a string', { text: { $gt: '' } }],
    ['a conversation id that is not a string', { conversationId: { not: '' } }],
    ['an oversized dimension', { width: 1e9 }],
  ])('answers %s with an error ack and sends nothing', async (_label, bad) => {
    const { gateway, sendMessage } = build();
    const ack = await gateway.handleSendMessage(socketFor(ALICE), {
      ...valid,
      ...bad,
    });
    expect(ack).toMatchObject({ status: 'error', tempId: 't1' });
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe('HTTP send fallback (A10)', () => {
  it('accepts the exact payload the client sends to both transports', async () => {
    // main.ts's global pipe. The client's fallback posts the socket payload,
    // `tempId` and `conversationId` included, and this used to be a 400.
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });
    await expect(
      pipe.transform(
        {
          tempId: 't1',
          clientId: 't1',
          conversationId: 'c1',
          text: 'hi',
          mentions: [],
        },
        { type: 'body', metatype: SendMessageDto },
      ),
    ).resolves.toBeInstanceOf(SendMessageDto);
  });
});

describe('unused presence handlers are gone (A9)', () => {
  it('no longer exposes presence:get or presence:get_status', () => {
    const proto = RealtimeGateway.prototype as unknown as Record<
      string,
      unknown
    >;
    expect(proto.handleGetPresence).toBeUndefined();
    expect(proto.handlePresenceGetStatus).toBeUndefined();
  });
});
