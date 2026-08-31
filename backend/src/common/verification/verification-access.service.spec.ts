import { ForbiddenException } from '@nestjs/common';
import { VerificationStatus } from '@prisma/client';
import { VerificationAccessService } from './verification-access.service';

describe('VerificationAccessService', () => {
  const originalFlag = process.env.FEATURE_VERIFICATION_ENABLED;
  let prisma: any;
  let domainEvents: any;
  let service: VerificationAccessService;

  const seed = (
    rows: { id: string; verificationStatus: VerificationStatus }[],
  ) => {
    prisma.user.findMany.mockImplementation(async ({ where }: any) =>
      rows.filter((r) => where.id.in.includes(r.id)),
    );
    prisma.user.findUnique.mockImplementation(
      async ({ where }: any) => rows.find((r) => r.id === where.id) || null,
    );
  };

  beforeEach(() => {
    delete process.env.FEATURE_VERIFICATION_ENABLED;
    prisma = {
      user: { findMany: jest.fn(), findUnique: jest.fn() },
      conversationParticipant: { findMany: jest.fn(async () => []) },
    };
    domainEvents = { emit: jest.fn(async () => {}) };
    service = new VerificationAccessService(prisma, domainEvents);
    // The status cache is process-level by design, so each case starts clean.
    service.invalidateAll();
  });

  afterAll(() => {
    if (originalFlag === undefined)
      delete process.env.FEATURE_VERIFICATION_ENABLED;
    else process.env.FEATURE_VERIFICATION_ENABLED = originalFlag;
  });

  it('treats VERIFIED as the only eligible status', () => {
    expect(service.isEligibleStatus(VerificationStatus.VERIFIED)).toBe(true);
    for (const s of [
      VerificationStatus.PENDING,
      VerificationStatus.UNVERIFIED,
      VerificationStatus.REJECTED,
      VerificationStatus.RESUBMISSION_REQUIRED,
    ]) {
      expect(service.isEligibleStatus(s)).toBe(false);
    }
    expect(service.isEligibleStatus(null)).toBe(false);
  });

  it('reports an id with no user row as ineligible rather than omitting it', async () => {
    seed([{ id: 'a', verificationStatus: VerificationStatus.VERIFIED }]);
    const map = await service.getEligibilityMap(['a', 'ghost']);
    expect(map.get('a')).toBe(true);
    expect(map.get('ghost')).toBe(false);
  });

  it('refuses a DM when only the recipient is unverified', async () => {
    seed([
      { id: 'sender', verificationStatus: VerificationStatus.VERIFIED },
      { id: 'recipient', verificationStatus: VerificationStatus.PENDING },
    ]);
    await expect(
      service.assertCanMessageInConversation(
        'c1',
        'sender',
        ['sender', 'recipient'],
        false,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('names neither party when the refusal is about the other side', async () => {
    seed([
      { id: 'sender', verificationStatus: VerificationStatus.VERIFIED },
      { id: 'recipient', verificationStatus: VerificationStatus.UNVERIFIED },
    ]);
    await expect(
      service.assertUsersEligible(['sender', 'recipient'], 'sender'),
    ).rejects.toThrow('This user is not available for messaging.');
  });

  it("uses the caller's own wording when the caller is the ineligible one", async () => {
    seed([
      { id: 'sender', verificationStatus: VerificationStatus.PENDING },
      { id: 'recipient', verificationStatus: VerificationStatus.VERIFIED },
    ]);
    await expect(
      service.assertUsersEligible(['sender', 'recipient'], 'sender'),
    ).rejects.toThrow(
      'Account verification is required to perform this action.',
    );
  });

  it('gates a group on the sender only, so one lapsed member does not silence it', async () => {
    seed([
      { id: 'sender', verificationStatus: VerificationStatus.VERIFIED },
      { id: 'lapsed', verificationStatus: VerificationStatus.REJECTED },
    ]);
    await expect(
      service.assertCanMessageInConversation(
        'g1',
        'sender',
        ['sender', 'lapsed'],
        true,
      ),
    ).resolves.toBeUndefined();
  });

  it('is a no-op everywhere when the feature flag is off', async () => {
    process.env.FEATURE_VERIFICATION_ENABLED = 'false';
    seed([{ id: 'sender', verificationStatus: VerificationStatus.UNVERIFIED }]);
    await expect(
      service.assertUsersEligible(['sender', 'recipient'], 'sender'),
    ).resolves.toBeUndefined();
    expect(await service.isUserEligible('sender')).toBe(true);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('announces a status change to the user and their DM partners', async () => {
    prisma.conversationParticipant.findMany.mockResolvedValue([
      { userId: 'partner-1' },
      { userId: 'partner-2' },
    ]);
    await service.announceStatusChange('subject', VerificationStatus.REJECTED);
    expect(domainEvents.emit).toHaveBeenCalledWith(
      'user:verification_changed',
      { userId: 'subject', verificationStatus: 'REJECTED', canMessage: false },
      ['subject', 'partner-1', 'partner-2'],
    );
  });
});

/**
 * The status cache exists so `@VerifiedOnly()` does not put a database
 * round-trip in front of every gated request. It is only defensible if a
 * revocation takes effect immediately rather than after a TTL, so these tests
 * pin the invalidation, not just the hit rate.
 */
describe('VerificationAccessService — status cache', () => {
  let prisma: any;
  let service: VerificationAccessService;

  const setStatus = (status: VerificationStatus) => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      verificationStatus: status,
    });
    prisma.user.findMany.mockResolvedValue([
      { id: 'u1', verificationStatus: status },
    ]);
  };

  beforeEach(() => {
    delete process.env.FEATURE_VERIFICATION_ENABLED;
    prisma = {
      user: { findMany: jest.fn(), findUnique: jest.fn() },
      conversationParticipant: { findMany: jest.fn(async () => []) },
    };
    service = new VerificationAccessService(prisma, { emit: jest.fn() } as any);
    service.invalidateAll();
  });

  it('reads the database once for repeated checks of the same user', async () => {
    setStatus(VerificationStatus.VERIFIED);
    for (let i = 0; i < 25; i++) {
      expect(await service.isUserEligible('u1')).toBe(true);
    }
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it('serves a revocation on the very next request, not after the TTL', async () => {
    setStatus(VerificationStatus.VERIFIED);
    expect(await service.isUserEligible('u1')).toBe(true);

    // Status revoked out-of-band, then announced.
    setStatus(VerificationStatus.REJECTED);
    await service.announceStatusChange('u1', VerificationStatus.REJECTED);

    expect(await service.isUserEligible('u1')).toBe(false);
  });

  it('an explicit invalidate is enough on its own', async () => {
    setStatus(VerificationStatus.VERIFIED);
    await service.isUserEligible('u1');

    // This is the path a peer instance takes when the Redis-relayed event
    // arrives: it never calls announceStatusChange, only invalidate.
    setStatus(VerificationStatus.UNVERIFIED);
    service.invalidate('u1');

    expect(await service.isUserEligible('u1')).toBe(false);
  });

  it('the batch path reuses entries the single path already cached', async () => {
    setStatus(VerificationStatus.VERIFIED);
    await service.isUserEligible('u1');

    prisma.user.findMany.mockResolvedValue([
      { id: 'u2', verificationStatus: VerificationStatus.VERIFIED },
    ]);
    const map = await service.getEligibilityMap(['u1', 'u2']);

    expect(map.get('u1')).toBe(true);
    expect(map.get('u2')).toBe(true);
    // Only the uncached id was queried — this is what makes the send path cost
    // one row rather than re-reading the sender the guard just resolved.
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['u2'] } },
      select: { id: true, verificationStatus: true },
    });
  });

  it('caches a missing user as ineligible without re-querying', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    expect(await service.isUserEligible('ghost')).toBe(false);
    expect(await service.isUserEligible('ghost')).toBe(false);
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
  });
});
