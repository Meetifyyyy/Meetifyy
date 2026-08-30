import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { WsException } from '@nestjs/websockets';
import { Test } from '@nestjs/testing';
import { VerificationGuard } from './verification.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { IS_VERIFIED_ONLY_KEY } from '../decorators/verified-only.decorator';

/**
 * Builds a minimal ExecutionContext double that simulates either an HTTP or
 * WebSocket invocation, depending on the `type` argument.
 */
function buildContext(opts: {
  type: 'http' | 'ws';
  userId?: string;
  handlerMetadata?: boolean;
}): ExecutionContext {
  const { type, userId, handlerMetadata } = opts;

  const mockGetHandler = jest.fn();
  const mockGetClass = jest.fn();

  const httpRequest = { user: userId ? { id: userId } : undefined };
  const wsClient = userId ? { userId } : {};

  return {
    getType: jest.fn(() => type),
    getHandler: mockGetHandler,
    getClass: mockGetClass,
    switchToHttp: jest.fn(() => ({ getRequest: jest.fn(() => httpRequest) })),
    switchToWs: jest.fn(() => ({ getClient: jest.fn(() => wsClient) })),
    // Metadata on the handler, used by Reflector.getAllAndOverride
    _handlerMetadata: handlerMetadata,
  } as unknown as ExecutionContext;
}

describe('VerificationGuard', () => {
  let guard: VerificationGuard;
  let reflector: Reflector;
  const mockPrisma = {
    user: { findUnique: jest.fn() },
  };

  const originalEnv = process.env.FEATURE_VERIFICATION_ENABLED;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        VerificationGuard,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    guard = module.get<VerificationGuard>(VerificationGuard);
    reflector = module.get<Reflector>(Reflector);
    jest.clearAllMocks();
    // Default: feature flag enabled
    delete process.env.FEATURE_VERIFICATION_ENABLED;
  });

  afterEach(() => {
    process.env.FEATURE_VERIFICATION_ENABLED = originalEnv;
  });

  // ── Helper: makes Reflector return the given isVerifiedOnly value ─────────
  function setMetadata(value: boolean) {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key: string) => {
        if (key === IS_VERIFIED_ONLY_KEY) return value;
        return undefined;
      });
  }

  // ─── Routes NOT decorated with @VerifiedOnly() ────────────────────────────

  describe('non-protected routes', () => {
    it('passes through when @VerifiedOnly() is not set', async () => {
      setMetadata(false);
      const ctx = buildContext({ type: 'http', userId: 'user-1' });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });
  });

  // ─── Feature flag disabled ─────────────────────────────────────────────────

  describe('when FEATURE_VERIFICATION_ENABLED=false', () => {
    beforeEach(() => {
      process.env.FEATURE_VERIFICATION_ENABLED = 'false';
    });

    it('skips DB check and passes any user through', async () => {
      setMetadata(true);
      const ctx = buildContext({ type: 'http', userId: 'user-1' });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('still passes when no userId is present on the request', async () => {
      setMetadata(true);
      const ctx = buildContext({ type: 'http' });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });

  // ─── HTTP context ─────────────────────────────────────────────────────────

  describe('HTTP context — @VerifiedOnly() route', () => {
    beforeEach(() => setMetadata(true));

    it.each([
      ['UNVERIFIED', 'UNVERIFIED'],
      ['PENDING', 'PENDING'],
      ['REJECTED', 'REJECTED'],
      ['RESUBMISSION_REQUIRED', 'RESUBMISSION_REQUIRED'],
    ])(
      'throws ForbiddenException when user status is %s',
      async (_, status) => {
        mockPrisma.user.findUnique.mockResolvedValue({
          verificationStatus: status,
        });
        const ctx = buildContext({ type: 'http', userId: 'user-1' });
        await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
      },
    );

    it('passes when user status is VERIFIED', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        verificationStatus: 'VERIFIED',
      });
      const ctx = buildContext({ type: 'http', userId: 'user-1' });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('throws ForbiddenException when user record is not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const ctx = buildContext({ type: 'http', userId: 'user-missing' });
      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });

    it('includes the correct error message', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        verificationStatus: 'PENDING',
      });
      const ctx = buildContext({ type: 'http', userId: 'user-1' });
      await expect(guard.canActivate(ctx)).rejects.toThrow(
        'Account verification is required to perform this action.',
      );
    });
  });

  // ─── WebSocket context ────────────────────────────────────────────────────

  describe('WebSocket context — @VerifiedOnly() route', () => {
    beforeEach(() => setMetadata(true));

    it('throws WsException (not ForbiddenException) for UNVERIFIED user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        verificationStatus: 'UNVERIFIED',
      });
      const ctx = buildContext({ type: 'ws', userId: 'user-1' });
      await expect(guard.canActivate(ctx)).rejects.toThrow(WsException);
    });

    it('throws WsException for PENDING user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        verificationStatus: 'PENDING',
      });
      const ctx = buildContext({ type: 'ws', userId: 'user-1' });
      await expect(guard.canActivate(ctx)).rejects.toThrow(WsException);
    });

    it('passes VERIFIED user over WebSocket', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        verificationStatus: 'VERIFIED',
      });
      const ctx = buildContext({ type: 'ws', userId: 'user-1' });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('reads userId from ws client, not HTTP request', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        verificationStatus: 'VERIFIED',
      });
      const ctx = buildContext({ type: 'ws', userId: 'ws-user' });
      await guard.canActivate(ctx);
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'ws-user' },
        select: { verificationStatus: true },
      });
    });
  });

  // ─── No userId on request ─────────────────────────────────────────────────

  describe('missing userId on @VerifiedOnly() route', () => {
    beforeEach(() => setMetadata(true));

    it('skips DB check and returns true when no userId (JwtGuard already blocked it)', async () => {
      // When the JWT guard has already run and rejected the request, the user
      // field will be absent. The VerificationGuard should not attempt a DB
      // query and should effectively pass (the earlier guard already refused).
      const ctx = buildContext({ type: 'http' }); // no userId
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });
  });
});
