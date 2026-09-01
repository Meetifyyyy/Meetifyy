import { AdminAccountDeletionService } from './admin-account-deletion.service';
import { PURGE_MAX_ATTEMPTS } from '../../account-deletion/account-deletion.constants';

/**
 * The admin queue. The behaviour worth pinning down is which actions it offers:
 * the page renders a control only when the corresponding flag is true, so a
 * flag that is true when the backend would refuse is exactly the "dead admin
 * button" this section was supposed to eliminate.
 */
describe('AdminAccountDeletionService — the deletion queue', () => {
  const DAY = 24 * 60 * 60 * 1000;

  let service: AdminAccountDeletionService;
  let prisma: any;
  let deletion: any;
  let purge: any;
  let rows: any[];

  const pendingRow = (over: any = {}) => ({
    id: 'u1',
    username: 'sam',
    email: 'sam@example.edu',
    accountStatus: 'PENDING_DELETION',
    deletionRequestedAt: new Date(Date.now() - DAY),
    // A whole-minute cushion so `Math.floor` does not drop a day on the few
    // milliseconds between building the fixture and reading the clock.
    scheduledPurgeAt: new Date(Date.now() + 29 * DAY + 60_000),
    purgeStartedAt: null,
    purgeCompletedAt: null,
    purgeAttempts: 0,
    purgeLastError: null,
    college: { id: 'c1', name: 'Example University' },
    ...over,
  });

  beforeEach(() => {
    rows = [pendingRow()];
    prisma = {
      user: {
        count: jest.fn(async () => rows.length),
        findMany: jest.fn(async () => rows),
        findUnique: jest.fn(async ({ where }: any) =>
          rows.find((r) => r.id === where.id) ?? null,
        ),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
    };
    deletion = { recoverAccount: jest.fn(async () => ({ pendingDeletion: false })) };
    purge = {
      purgeUser: jest.fn(async () => ({ purged: true })),
      runSweep: jest.fn(async () => ({ claimed: 2, purged: 2, failed: 0 })),
    };
    service = new AdminAccountDeletionService(prisma, deletion, purge);
  });

  it('lists pending requests with the deadline and the time left', async () => {
    const res = await service.list({});
    expect(res.requests).toHaveLength(1);
    expect(res.requests[0]).toMatchObject({
      userId: 'u1',
      username: 'sam',
      status: 'pending',
      daysRemaining: 29,
      dueNow: false,
      canRestore: true,
      canPurgeNow: true,
    });
    expect(res.recoveryWindowDays).toBe(30);
  });

  it('marks a row past its deadline as due', async () => {
    rows = [pendingRow({ scheduledPurgeAt: new Date(Date.now() - DAY) })];
    const res = await service.list({});
    expect(res.requests[0]).toMatchObject({ status: 'due', dueNow: true });
  });

  it('marks a row at the attempt ceiling as failed and surfaces the error', async () => {
    rows = [
      pendingRow({
        scheduledPurgeAt: new Date(Date.now() - DAY),
        purgeAttempts: PURGE_MAX_ATTEMPTS,
        purgeLastError: 'R2 unavailable',
      }),
    ];
    const res = await service.list({});
    expect(res.requests[0]).toMatchObject({
      status: 'failed',
      purgeLastError: 'R2 unavailable',
    });
  });

  describe('no action is offered that the backend would refuse', () => {
    it('hides Restore once the purge worker has claimed the row', async () => {
      rows = [pendingRow({ purgeStartedAt: new Date() })];
      const [req] = (await service.list({})).requests;
      expect(req.canRestore).toBe(false);
      expect(req.purgeInProgress).toBe(true);
      // Purging is still possible — that is the retry path.
      expect(req.canPurgeNow).toBe(true);
    });

    it('hides Restore once the recovery window has closed', async () => {
      rows = [pendingRow({ scheduledPurgeAt: new Date(Date.now() - 1000) })];
      const [req] = (await service.list({})).requests;
      expect(req.canRestore).toBe(false);
    });

    it('offers neither action on an already-deleted account', async () => {
      rows = [
        pendingRow({
          accountStatus: 'DELETED',
          username: 'deleted_u1_123',
          purgeCompletedAt: new Date(),
          scheduledPurgeAt: new Date(Date.now() - 5 * DAY),
        }),
      ];
      const [req] = (await service.list({})).requests;
      expect(req).toMatchObject({
        status: 'completed',
        canRestore: false,
        canPurgeNow: false,
        daysRemaining: null,
      });
    });
  });

  it('restores through the same service the user’s own Recover button uses', async () => {
    // Not a second implementation: an admin restore has to inherit the same
    // window check and the same race handling, or the two paths drift.
    await service.restore('u1');
    expect(deletion.recoverAccount).toHaveBeenCalledWith('u1');
  });

  it('clears the attempt ceiling before an operator-requested purge', async () => {
    await service.purgeNow('u1');
    const [{ data }] = prisma.user.updateMany.mock.calls[0];
    expect(data.purgeAttempts).toBe(0);
    expect(purge.purgeUser).toHaveBeenCalledWith('u1');
  });

  it('runs a sweep on demand and reports what it did', async () => {
    await expect(service.runSweep()).resolves.toMatchObject({
      success: true,
      purged: 2,
      failed: 0,
    });
  });

  it('narrows rather than widens the status filter when searching in "all"', async () => {
    await service.list({ filter: 'all', search: 'sam' });
    const [{ where }] = prisma.user.findMany.mock.calls[0];
    // The naive version overwrote `where.OR` with the search clause, which
    // silently dropped the status filter and listed active accounts too.
    expect(where.OR).toBeUndefined();
    expect(where.AND).toHaveLength(2);
  });
});
