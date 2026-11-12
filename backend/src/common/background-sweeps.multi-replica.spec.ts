import { Logger } from '@nestjs/common';
import { UserSessionRetentionService } from '../auth/session/user-session-retention.service';
import { ErrorLogRetentionService } from '../observability/error-log-retention.service';
import { SlowRequestRetentionService } from '../observability/slow-request-retention.service';
import { VerificationUploadCollectorService } from '../verification/verification-upload-collector.service';
import { MessagesService } from '../messages/messages.service';
import { sharedLock } from '../redis/testing/shared-lock';
import { stub } from './testing/stub';
import type { UserSessionService } from '../auth/session/user-session.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { StorageService } from '../uploads/uploads.service';
import type { PresenceService } from '../presence/presence.service';
import type { DomainEventService } from '../events/domain-event.service';
import type { MentionsService } from '../mentions/mentions.service';
import type { BlocksService } from '../users/blocks.service';
import type { VerificationAccessService } from './verification/verification-access.service';
import type { RateLimitService } from './rate-limit/rate-limit.service';

/**
 * Housekeeping sweeps run on every replica, at boot and on a timer. They are
 * safe to repeat, so the lock only stops two replicas doing the same pass at
 * once. Each case starts the same pass on two "replicas" together, holds the
 * first one open, and expects the second to be skipped.
 */

/** A pass that stays in flight until `release` is called. */
function heldOpen<T>(result: T) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const work = jest.fn(async () => {
    await gate;
    return result;
  });
  return { work, release };
}

describe('Background sweeps on two replicas', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('purges expired sessions once', async () => {
    const lock = sharedLock();
    const { work, release } = heldOpen(0);
    const build = () =>
      new UserSessionRetentionService(
        stub<UserSessionService>({ purgeExpired: work }),
        lock,
      );
    const a = build();
    const b = build();

    const first = a['sweepOnOneReplica']();
    const second = b['sweepOnOneReplica']();
    release();
    await Promise.all([first, second]);

    expect(work).toHaveBeenCalledTimes(1);
  });

  it('prunes the error log once', async () => {
    const lock = sharedLock();
    const { work, release } = heldOpen<never[]>([]);
    const build = () =>
      new ErrorLogRetentionService(
        stub<PrismaService>({ errorLog: { findMany: work } }),
        lock,
      );
    const first = build()['sweepOnOneReplica']();
    const second = build()['sweepOnOneReplica']();
    release();
    await Promise.all([first, second]);

    expect(work).toHaveBeenCalledTimes(1);
  });

  it('prunes slow requests once', async () => {
    const lock = sharedLock();
    const { work, release } = heldOpen<never[]>([]);
    const build = () =>
      new SlowRequestRetentionService(
        stub<PrismaService>({ slowRequest: { findMany: work } }),
        lock,
      );
    const first = build()['sweepOnOneReplica']();
    const second = build()['sweepOnOneReplica']();
    release();
    await Promise.all([first, second]);

    expect(work).toHaveBeenCalledTimes(1);
  });

  it('collects abandoned verification uploads once', async () => {
    const lock = sharedLock();
    const { work, release } = heldOpen<never[]>([]);
    const build = () =>
      new VerificationUploadCollectorService(
        stub<PrismaService>({ media: { findMany: work } }),
        stub<StorageService>(),
        lock,
      );
    const first = build()['sweepOnOneReplica']();
    const second = build()['sweepOnOneReplica']();
    release();
    await Promise.all([first, second]);

    expect(work).toHaveBeenCalledTimes(1);
  });

  it('removes expired instant-match chats once', async () => {
    const lock = sharedLock();
    const { work, release } = heldOpen<never[]>([]);
    const build = () =>
      new MessagesService(
        stub<PrismaService>({ conversation: { findMany: work } }),
        stub<PresenceService>(),
        stub<DomainEventService>(),
        stub<MentionsService>(),
        stub<BlocksService>(),
        stub<VerificationAccessService>(),
        stub<RateLimitService>(),
        lock,
      );
    const first = build()['cleanupExpiredInstantMatchesOnOneReplica']();
    const second = build()['cleanupExpiredInstantMatchesOnOneReplica']();
    release();
    await Promise.all([first, second]);

    expect(work).toHaveBeenCalledTimes(1);
  });

  it('still sweeps when no Redis is configured', async () => {
    const purgeExpired = jest.fn().mockResolvedValue(0);
    const service = new UserSessionRetentionService(
      stub<UserSessionService>({ purgeExpired }),
    );

    await service['sweepOnOneReplica']();

    expect(purgeExpired).toHaveBeenCalledTimes(1);
  });
});
