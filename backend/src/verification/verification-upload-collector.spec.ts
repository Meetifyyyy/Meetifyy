import { VerificationUploadCollectorService } from './verification-upload-collector.service';

/**
 * Submitted verification documents are retained indefinitely. This collector
 * exists only for uploads that never became part of a request — an abandoned
 * form leaves ID photos in the bucket that nothing references and no other
 * cleanup path can reach.
 *
 * The property that matters is the one it must never violate: a document a
 * request points at is invisible to it.
 */
describe('VerificationUploadCollectorService', () => {
  const HOUR = 60 * 60 * 1000;
  let prisma: any;
  let storage: any;
  let service: VerificationUploadCollectorService;

  beforeEach(() => {
    delete process.env.VERIFICATION_ABANDONED_UPLOAD_HOURS;
    prisma = {
      media: {
        findMany: jest.fn(async (): Promise<any[]> => []),
        deleteMany: jest.fn(async () => ({ count: 0 })),
      },
    };
    storage = { delete: jest.fn(async () => true) };
    service = new VerificationUploadCollectorService(prisma, storage);
  });

  afterAll(() => delete process.env.VERIFICATION_ABANDONED_UPLOAD_HOURS);

  const where = () => prisma.media.findMany.mock.calls[0][0].where;

  it('only ever looks under the verification prefix', async () => {
    await service.sweep();
    expect(where().objectKey).toEqual({ startsWith: 'verification/' });
  });

  it('excludes anything a verification request references', async () => {
    // Enforced in the query, not by a later filter — a submitted document is
    // never even a candidate.
    await service.sweep();
    expect(where().verificationSelfies).toEqual({ none: {} });
    expect(where().verificationIdCards).toEqual({ none: {} });
  });

  it('leaves recent uploads alone, so an in-flight submission is safe', async () => {
    const before = Date.now();
    await service.sweep();
    const cutoff = where().createdAt.lt.getTime();
    expect(before - cutoff).toBeGreaterThanOrEqual(24 * HOUR - 5000);
  });

  it('lets an operator tune the grace period', async () => {
    process.env.VERIFICATION_ABANDONED_UPLOAD_HOURS = '2';
    const before = Date.now();
    await service.sweep();
    const cutoff = where().createdAt.lt.getTime();
    expect(before - cutoff).toBeLessThan(3 * HOUR);
  });

  it('ignores a nonsense grace value rather than sweeping everything', async () => {
    process.env.VERIFICATION_ABANDONED_UPLOAD_HOURS = 'not-a-number';
    const before = Date.now();
    await service.sweep();
    // Falls back to the default instead of a cutoff of "now".
    expect(before - where().createdAt.lt.getTime()).toBeGreaterThanOrEqual(
      24 * HOUR - 5000,
    );
  });

  it('removes the object and then the row', async () => {
    prisma.media.findMany.mockResolvedValue([
      { id: 'm1', objectKey: 'verification/abandoned.webp' },
    ]);
    const collected = await service.sweep();

    expect(collected).toBe(1);
    expect(storage.delete).toHaveBeenCalledWith('verification/abandoned.webp');
    expect(prisma.media.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['m1'] } },
    });
  });

  it('does not re-attempt an object storage refuses to delete', async () => {
    prisma.media.findMany.mockResolvedValue([
      { id: 'm1', objectKey: 'verification/stuck.webp' },
    ]);
    storage.delete.mockRejectedValue(new Error('R2 unavailable'));

    await expect(service.sweep()).resolves.toBe(1);
    // The row still goes, so the sweep does not spin on it forever.
    expect(prisma.media.deleteMany).toHaveBeenCalled();
  });

  it('never throws out of the timer', async () => {
    prisma.media.findMany.mockRejectedValue(new Error('db down'));
    await expect(service.sweep()).resolves.toBe(0);
  });
});
