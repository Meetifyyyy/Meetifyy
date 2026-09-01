import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtGuard } from './jwt.guard';
import { ALLOW_SUSPENDED_KEY } from '../decorators/allow-suspended.decorator';
import { ALLOW_PENDING_DELETION_KEY } from '../decorators/allow-pending-deletion.decorator';

/**
 * What a restricted account may still reach.
 *
 * The bug this pins down: `POST /api/auth/sync` was refused for a suspended or
 * pending-deletion account. That route carries `accountStatus`, and it is the
 * only thing either gate keys off — so refusing it meant the client never
 * learned it was restricted. A user who signed in during their 30-day deletion
 * window got a 403, `currentUser` stayed null, and the recovery screen never
 * mounted: signed in, no profile, no explanation, and no way to reach the
 * Recover button.
 *
 * The two gates are also resolved independently. An early return on
 * `@AllowSuspended()` would have let a pending-deletion account through every
 * route the suspension flow opens.
 */
describe('JwtGuard — routes a restricted account may reach', () => {
  const USER_ID = 'user-1';

  let guard: JwtGuard;
  let prisma: any;
  let accountStatus: string;

  /** Builds a context whose handler carries the given decorators. */
  const contextWith = (decorators: string[] = []) => {
    const reflector = new Reflector();
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key: any) => decorators.includes(key) as any);
    (guard as any).reflector = reflector;

    return {
      getHandler: () => () => undefined,
      getClass: () => class {},
    } as any;
  };

  const enforce = (ctx: any) =>
    (guard as any).enforceAccountStatus(ctx, { id: USER_ID });

  beforeEach(() => {
    accountStatus = 'ACTIVE';
    JwtGuard.clearAccountStatus(USER_ID);
    prisma = {
      user: {
        findUnique: jest.fn(async () => ({ accountStatus })),
      },
    };
    // (supabaseService, prisma, reflector) — the reflector is swapped per test
    // by `contextWith`, which is what selects the decorators under test.
    guard = new JwtGuard({} as any, prisma, new Reflector());
  });

  afterEach(() => JwtGuard.clearAccountStatus(USER_ID));

  it('lets an active account through any route', async () => {
    await expect(enforce(contextWith())).resolves.toBeUndefined();
  });

  describe('pending deletion', () => {
    beforeEach(() => {
      accountStatus = 'PENDING_DELETION';
    });

    it('refuses an ordinary route', async () => {
      await expect(enforce(contextWith())).rejects.toThrow(ForbiddenException);
    });

    it('carries a machine-readable code so the client can show the gate', async () => {
      const err: any = await enforce(contextWith()).catch((e: any) => e);
      expect(err.getResponse()).toMatchObject({
        code: 'ACCOUNT_PENDING_DELETION',
      });
    });

    it('allows a route marked @AllowPendingDeletion', async () => {
      // Profile sync, deletion status, and the two recovery routes. Without
      // this the recovery screen cannot be reached at all.
      await expect(
        enforce(contextWith([ALLOW_PENDING_DELETION_KEY])),
      ).resolves.toBeUndefined();
    });

    it('is NOT let through by @AllowSuspended alone', async () => {
      // The two gates are independent. An early return on the suspension
      // decorator would have opened the entire appeal flow to a deleting
      // account.
      await expect(
        enforce(contextWith([ALLOW_SUSPENDED_KEY])),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('suspended', () => {
    beforeEach(() => {
      accountStatus = 'SUSPENDED';
    });

    it('refuses an ordinary route', async () => {
      await expect(enforce(contextWith())).rejects.toThrow(ForbiddenException);
    });

    it('allows a route marked @AllowSuspended', async () => {
      await expect(
        enforce(contextWith([ALLOW_SUSPENDED_KEY])),
      ).resolves.toBeUndefined();
    });

    it('is NOT let through by @AllowPendingDeletion alone', async () => {
      await expect(
        enforce(contextWith([ALLOW_PENDING_DELETION_KEY])),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  it('lets a route carrying BOTH decorators serve either state', async () => {
    // This is exactly `POST /api/auth/sync`: it must answer for a suspended
    // account and a deleting one, because its payload is what tells the client
    // which of the two screens to render.
    const both = [ALLOW_SUSPENDED_KEY, ALLOW_PENDING_DELETION_KEY];

    accountStatus = 'SUSPENDED';
    JwtGuard.clearAccountStatus(USER_ID);
    await expect(enforce(contextWith(both))).resolves.toBeUndefined();

    accountStatus = 'PENDING_DELETION';
    JwtGuard.clearAccountStatus(USER_ID);
    await expect(enforce(contextWith(both))).resolves.toBeUndefined();
  });

  it('never blocks a request because the status lookup broke', async () => {
    // A database blip must not lock everyone out of the app; the gate is a
    // restriction, not an authentication step.
    prisma.user.findUnique = jest.fn(async () => {
      throw new Error('connection reset');
    });
    await expect(enforce(contextWith())).resolves.toBeUndefined();
  });
});
