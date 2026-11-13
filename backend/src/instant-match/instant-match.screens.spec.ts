import {
  InstantMatchService,
  setRealtimeGatewayRef,
} from './instant-match.service';
import {
  PrismaFake,
  blocksStubFor,
  createEmitterMock,
} from './testing/prisma-fake';
import { stub } from '../common/testing/stub';
import type { MessagesService } from '../messages/messages.service';
import { createVerificationAccessMock } from '../common/verification/testing/verification-access.mock';

/**
 * IM-19: someone with Instant Match open on two tabs or devices. Accepting on
 * one must move the others to the wait, or a Pass there declines the match
 * they have just accepted. And the wait is labelled "Request sent" only for
 * a request they actually sent.
 */
describe('Instant Match on more than one screen (IM-19)', () => {
  let prisma: PrismaFake;
  let service: InstantMatchService;
  let emitter: ReturnType<typeof createEmitterMock>;
  const MIN = 60_000;
  const snap = {
    campus: 'campus-a',
    activity: 'study',
    timePreference: 'now',
    optionalDetail: null,
    area: null,
    gps: null,
  };

  beforeEach(() => {
    prisma = new PrismaFake();
    emitter = createEmitterMock();
    setRealtimeGatewayRef(emitter);
    for (const id of ['alice', 'bob']) prisma.seedUser(id);
    service = new InstantMatchService(
      prisma.asService(),
      stub<MessagesService>({
        registerInstantMatchGuard: jest.fn(),
        createInstantMatchConversation: jest.fn(() =>
          Promise.resolve({
            id: 'pub-c',
            internalId: 'conv-c',
            expiresAt: Date.now() + 24 * 60 * MIN,
          }),
        ),
      }),
      blocksStubFor(prisma),
      createVerificationAccessMock(),
    );
  });

  const rankerMatch = () =>
    prisma.seedSession({
      id: 'm1',
      userAId: 'alice',
      userBId: 'bob',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + MIN),
      snapshotA: snap,
      snapshotB: snap,
    });

  it('accepting first tells every screen of that person to show the wait', async () => {
    rankerMatch();
    await service.respondToMatch('alice', 'm1', 'accept');

    expect(emitter.emitMatchWaiting).toHaveBeenCalledTimes(1);
    expect(emitter.emitMatchWaiting).toHaveBeenCalledWith('alice', {
      matchId: 'm1',
    });
    expect(emitter.emitMatchAccepted).not.toHaveBeenCalled();
  });

  it('the other side is told they are the one being waited for (IM-26)', async () => {
    rankerMatch();
    await service.respondToMatch('alice', 'm1', 'accept');

    expect(emitter.emitMatchPartnerAccepted).toHaveBeenCalledTimes(1);
    expect(emitter.emitMatchPartnerAccepted).toHaveBeenCalledWith('bob', {
      matchId: 'm1',
    });
    expect((await service.getStateFor('bob')).pendingMatch).toMatchObject({
      matchId: 'm1',
      awaitingOther: false,
      partnerAccepted: true,
    });
    expect((await service.getStateFor('alice')).pendingMatch).toMatchObject({
      partnerAccepted: false,
    });
  });

  it('the second acceptance opens the chat instead of another wait', async () => {
    rankerMatch();
    await service.respondToMatch('alice', 'm1', 'accept');
    await service.respondToMatch('bob', 'm1', 'accept');

    expect(emitter.emitMatchWaiting).toHaveBeenCalledTimes(1);
    expect(emitter.emitMatchAccepted).toHaveBeenCalledTimes(2);
  });

  it('after a reload, an accepted match waits without claiming a request was sent', async () => {
    rankerMatch();
    await service.respondToMatch('alice', 'm1', 'accept');

    const { pendingMatch } = await service.getStateFor('alice');
    expect(pendingMatch).toMatchObject({
      matchId: 'm1',
      awaitingOther: true,
      requestSent: false,
    });
  });

  it('a request is marked as sent for the person who sent it, and only them', async () => {
    prisma.seedQueueEntry('alice');
    prisma.seedQueueEntry('bob');
    await service.requestMatch('alice', 'bob');

    const toAlice = emitter.emitMatchFound.mock.calls.find(
      ([to]) => to === 'alice',
    );
    expect(toAlice?.[1]).toMatchObject({
      awaitingOther: true,
      requestSent: true,
    });
    expect((await service.getStateFor('alice')).pendingMatch).toMatchObject({
      awaitingOther: true,
      requestSent: true,
    });
    expect((await service.getStateFor('bob')).pendingMatch).toMatchObject({
      awaitingOther: false,
      requestSent: false,
      requested: true,
    });
  });
});
