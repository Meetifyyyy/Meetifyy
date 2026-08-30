import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { WsException } from '@nestjs/websockets';
import { VerificationStatus } from '@prisma/client';
import { VerificationGuard } from '../guards/verification.guard';
import { VerificationAccessService } from './verification-access.service';
import { IS_VERIFIED_ONLY_KEY } from '../decorators/verified-only.decorator';

/**
 * The access-control matrix: every account state against a gated action, over
 * both transports.
 *
 * The point is exhaustiveness. Enumerating `VerificationStatus` from the Prisma
 * enum rather than listing statuses by hand means a status added to the schema
 * later shows up here as a failing case that somebody has to classify, instead
 * of silently defaulting to "allowed".
 */
describe('verification access matrix', () => {
  const ELIGIBLE: VerificationStatus[] = [VerificationStatus.VERIFIED];
  const INELIGIBLE = Object.values(VerificationStatus).filter(
    (s) => !ELIGIBLE.includes(s),
  );

  let prisma: any;
  let access: VerificationAccessService;
  let guard: VerificationGuard;
  let reflector: Reflector;

  const context = (opts: {
    type: 'http' | 'ws';
    userId?: string;
  }): ExecutionContext =>
    ({
      getType: () => opts.type,
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ user: opts.userId ? { id: opts.userId } : undefined }),
      }),
      switchToWs: () => ({
        getClient: () => (opts.userId ? { userId: opts.userId } : {}),
      }),
    }) as unknown as ExecutionContext;

  const asUser = (status: VerificationStatus | null) => {
    access.invalidateAll();
    prisma.user.findUnique.mockResolvedValue(
      status ? { id: 'u1', verificationStatus: status } : null,
    );
    prisma.user.findMany.mockResolvedValue(
      status ? [{ id: 'u1', verificationStatus: status }] : [],
    );
  };

  beforeEach(() => {
    delete process.env.FEATURE_VERIFICATION_ENABLED;
    prisma = {
      user: { findUnique: jest.fn(), findMany: jest.fn() },
      conversationParticipant: { findMany: jest.fn(async () => []) },
    };
    access = new VerificationAccessService(prisma, { emit: jest.fn() } as any);
    reflector = new Reflector();
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key) => key === IS_VERIFIED_ONLY_KEY);
    guard = new VerificationGuard(reflector, access);
  });

  describe.each(INELIGIBLE)('an account in %s', (status) => {
    it('is refused a gated HTTP action', async () => {
      asUser(status);
      await expect(guard.canActivate(context({ type: 'http', userId: 'u1' }))).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('is refused a gated socket event', async () => {
      asUser(status);
      await expect(guard.canActivate(context({ type: 'ws', userId: 'u1' }))).rejects.toThrow(
        WsException,
      );
    });

    it('cannot open a direct conversation', async () => {
      asUser(status);
      await expect(access.assertUsersEligible(['u1', 'other'], 'u1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe.each(ELIGIBLE)('an account in %s', (status) => {
    it('is allowed a gated HTTP action', async () => {
      asUser(status);
      await expect(
        guard.canActivate(context({ type: 'http', userId: 'u1' })),
      ).resolves.toBe(true);
    });

    it('is allowed a gated socket event', async () => {
      asUser(status);
      await expect(
        guard.canActivate(context({ type: 'ws', userId: 'u1' })),
      ).resolves.toBe(true);
    });
  });

  it('refuses an account whose user row has vanished', async () => {
    asUser(null);
    await expect(
      guard.canActivate(context({ type: 'http', userId: 'ghost' })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('leaves an unauthenticated request to the auth guard rather than passing it as verified', async () => {
    // No user id on the request: this guard is not the authentication check,
    // and JwtGuard has already rejected it. What matters is that it does not
    // throw a *verification* error that would mask a 401 as a 403.
    asUser(null);
    await expect(guard.canActivate(context({ type: 'http' }))).resolves.toBe(true);
  });

  it('opens everything when the feature flag is off', async () => {
    process.env.FEATURE_VERIFICATION_ENABLED = 'false';
    asUser(VerificationStatus.UNVERIFIED);
    await expect(
      guard.canActivate(context({ type: 'http', userId: 'u1' })),
    ).resolves.toBe(true);
  });
});
