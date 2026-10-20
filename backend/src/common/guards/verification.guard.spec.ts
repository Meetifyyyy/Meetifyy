import {
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  UnauthorizedException,
  UseGuards,
  CanActivate,
  Injectable,
  type INestApplication,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { Server } from 'http';
import { VerifiedOnly } from '../decorators/verified-only.decorator';
import { JwtGuard } from './jwt.guard';
import { USER_ACCESS_COOKIE } from '../../auth/session/user-session-cookies';
import type { GuardRequest } from '../types/authenticated-request';
import { Reflector } from '@nestjs/core';
import { WsException } from '@nestjs/websockets';
import { Test } from '@nestjs/testing';
import { VerificationGuard } from './verification.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { VerificationAccessService } from '../verification/verification-access.service';
import { DomainEventService } from '../../events/domain-event.service';
import { IS_VERIFIED_ONLY_KEY } from '../decorators/verified-only.decorator';
import { stub } from '../testing/stub';

/**
 * Builds a minimal ExecutionContext double that simulates either an HTTP or
 * WebSocket invocation, depending on the `type` argument.
 */
function buildContext(opts: {
  type: 'http' | 'ws';
  userId?: string;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
}): ExecutionContext {
  const { type, userId } = opts;

  const mockGetHandler = jest.fn();
  const mockGetClass = jest.fn();

  const httpRequest = {
    user: userId ? { id: userId } : undefined,
    headers: opts.headers ?? {},
    cookies: opts.cookies ?? {},
  };
  const wsClient = { data: userId ? { userId } : {} };

  return stub<ExecutionContext>({
    getType: jest.fn(() => type),
    getHandler: mockGetHandler,
    getClass: mockGetClass,
    switchToHttp: jest.fn(() => ({ getRequest: jest.fn(() => httpRequest) })),
    switchToWs: jest.fn(() => ({ getClient: jest.fn(() => wsClient) })),
  });
}

/** A user row as the policy service reads it: ACTIVE and not soft-deleted. */
const activeRow = (verificationStatus?: string) => ({
  verificationStatus,
  accountStatus: 'ACTIVE',
  deletedAt: null,
});

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
        // The real policy service, backed by the mock Prisma: the guard now
        // delegates the status rule to it, so stubbing it out would test nothing.
        VerificationAccessService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: DomainEventService, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    guard = module.get<VerificationGuard>(VerificationGuard);
    module.get(VerificationAccessService).invalidateAll();
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
      .mockImplementation((key: unknown) => {
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
        mockPrisma.user.findUnique.mockResolvedValue(activeRow(status));
        const ctx = buildContext({ type: 'http', userId: 'user-1' });
        await expect(guard.canActivate(ctx)).rejects.toThrow(
          ForbiddenException,
        );
      },
    );

    it('passes when user status is VERIFIED', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(activeRow('VERIFIED'));
      const ctx = buildContext({ type: 'http', userId: 'user-1' });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('throws ForbiddenException when user record is not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const ctx = buildContext({ type: 'http', userId: 'user-missing' });
      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });

    it('includes the correct error message', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(activeRow('PENDING'));
      const ctx = buildContext({ type: 'http', userId: 'user-1' });
      await expect(guard.canActivate(ctx)).rejects.toThrow(
        'Account verification is required to perform this action.',
      );
    });

    it('carries the machine-readable VERIFICATION_REQUIRED code', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(activeRow('PENDING'));
      const ctx = buildContext({ type: 'http', userId: 'user-1' });
      const err: unknown = await guard
        .canActivate(ctx)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).getResponse()).toMatchObject({
        code: 'VERIFICATION_REQUIRED',
        message: 'Account verification is required to perform this action.',
      });
    });
  });

  // ─── WebSocket context ────────────────────────────────────────────────────

  describe('WebSocket context — @VerifiedOnly() route', () => {
    beforeEach(() => setMetadata(true));

    it('throws WsException (not ForbiddenException) for UNVERIFIED user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(activeRow('UNVERIFIED'));
      const ctx = buildContext({ type: 'ws', userId: 'user-1' });
      await expect(guard.canActivate(ctx)).rejects.toThrow(WsException);
    });

    it('throws WsException for PENDING user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(activeRow('PENDING'));
      const ctx = buildContext({ type: 'ws', userId: 'user-1' });
      await expect(guard.canActivate(ctx)).rejects.toThrow(WsException);
    });

    it('passes VERIFIED user over WebSocket', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(activeRow('VERIFIED'));
      const ctx = buildContext({ type: 'ws', userId: 'user-1' });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('reads userId from ws client, not HTTP request', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(activeRow('VERIFIED'));
      const ctx = buildContext({ type: 'ws', userId: 'ws-user' });
      await guard.canActivate(ctx);
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'ws-user' },
        select: expect.objectContaining({
          verificationStatus: true,
        }) as unknown,
      });
    });
  });

  // ─── No userId on request ─────────────────────────────────────────────────

  describe('missing userId on @VerifiedOnly() route', () => {
    beforeEach(() => setMetadata(true));

    it('fails closed (401) on HTTP when no identity can be resolved', async () => {
      // This guard is an APP_GUARD, so it runs BEFORE JwtGuard: an absent user
      // does not mean "JwtGuard already refused it", it means nobody has been
      // identified yet. Waving that through made @VerifiedOnly inert.
      const ctx = buildContext({ type: 'http' }); // no userId
      await expect(guard.canActivate(ctx)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });
  });

  // ─── Identity resolved by the guard itself (HTTP, before JwtGuard) ────────

  describe('HTTP identity resolution (guard runs before JwtGuard)', () => {
    let resolving: VerificationGuard;
    const peekUserId = jest.fn<Promise<string | null>, [string]>();

    beforeEach(async () => {
      const module = await Test.createTestingModule({
        providers: [
          VerificationGuard,
          VerificationAccessService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: DomainEventService, useValue: { emit: jest.fn() } },
          { provide: JwtGuard, useValue: stub<JwtGuard>({ peekUserId }) },
        ],
      }).compile();
      resolving = module.get(VerificationGuard);
      module.get(VerificationAccessService).invalidateAll();
      jest
        .spyOn(module.get(Reflector), 'getAllAndOverride')
        .mockReturnValue(true);
      peekUserId.mockReset();
    });

    it('refuses an unverified cookie-authenticated user', async () => {
      peekUserId.mockResolvedValue('user-1');
      mockPrisma.user.findUnique.mockResolvedValue(activeRow('UNVERIFIED'));
      const ctx = buildContext({
        type: 'http',
        cookies: { [USER_ACCESS_COOKIE]: 'cookie-token' },
      });
      await expect(resolving.canActivate(ctx)).rejects.toThrow(
        ForbiddenException,
      );
      expect(peekUserId).toHaveBeenCalledWith('cookie-token');
    });

    it('refuses an unverified bearer-authenticated user', async () => {
      peekUserId.mockResolvedValue('user-1');
      mockPrisma.user.findUnique.mockResolvedValue(activeRow('PENDING'));
      const ctx = buildContext({
        type: 'http',
        headers: { authorization: 'Bearer header-token' },
      });
      await expect(resolving.canActivate(ctx)).rejects.toThrow(
        ForbiddenException,
      );
      expect(peekUserId).toHaveBeenCalledWith('header-token');
    });

    it('prefers the cookie over the header, as JwtGuard does', async () => {
      peekUserId.mockResolvedValue('user-1');
      mockPrisma.user.findUnique.mockResolvedValue(activeRow('VERIFIED'));
      const ctx = buildContext({
        type: 'http',
        headers: { authorization: 'Bearer header-token' },
        cookies: { [USER_ACCESS_COOKIE]: 'cookie-token' },
      });
      await expect(resolving.canActivate(ctx)).resolves.toBe(true);
      expect(peekUserId).toHaveBeenCalledWith('cookie-token');
    });

    it('answers 401 for a token it cannot verify', async () => {
      peekUserId.mockResolvedValue(null);
      const ctx = buildContext({
        type: 'http',
        headers: { authorization: 'Bearer forged' },
      });
      await expect(resolving.canActivate(ctx)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('answers 401 when verification throws', async () => {
      peekUserId.mockRejectedValue(new Error('boom'));
      const ctx = buildContext({
        type: 'http',
        headers: { authorization: 'Bearer x' },
      });
      await expect(resolving.canActivate(ctx)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // ─── Real Nest guard ordering ─────────────────────────────────────────────

  describe('guard ordering (APP_GUARD runs before the route @UseGuards)', () => {
    /** Stands in for JwtGuard: it is the thing that sets request.user. */
    @Injectable()
    class RouteAuthGuard implements CanActivate {
      canActivate(context: ExecutionContext): boolean {
        const req = context.switchToHttp().getRequest<GuardRequest>();
        const token = String(req.headers.authorization ?? '').replace(
          'Bearer ',
          '',
        );
        req.user = { id: token } as GuardRequest['user'];
        return true;
      }
    }

    @Controller('gated')
    class GatedController {
      @Get()
      @UseGuards(RouteAuthGuard)
      @VerifiedOnly()
      gated() {
        return { ok: true };
      }
    }

    let app: INestApplication;
    const status = new Map<string, string>([
      ['verified-user', 'VERIFIED'],
      ['unverified-user', 'UNVERIFIED'],
    ]);

    beforeEach(async () => {
      const module = await Test.createTestingModule({
        controllers: [GatedController],
        providers: [
          RouteAuthGuard,
          VerificationAccessService,
          { provide: APP_GUARD, useClass: VerificationGuard },
          {
            provide: PrismaService,
            useValue: {
              user: {
                findUnique: jest.fn(({ where }: { where: { id: string } }) =>
                  Promise.resolve(activeRow(status.get(where.id))),
                ),
              },
            },
          },
          { provide: DomainEventService, useValue: { emit: jest.fn() } },
          {
            provide: JwtGuard,
            useValue: stub<JwtGuard>({
              // Local verification: the token IS the user id in this double.
              peekUserId: (t: string) => Promise.resolve(t || null),
            }),
          },
        ],
      }).compile();
      app = module.createNestApplication();
      app.use(cookieParser());
      await app.init();
      module.get(VerificationAccessService).invalidateAll();
      delete process.env.FEATURE_VERIFICATION_ENABLED;
    });

    afterEach(async () => {
      await app.close();
    });

    const server = (): Server => app.getHttpServer() as Server;

    it('403s an unverified user over real HTTP', async () => {
      await request(server())
        .get('/gated')
        .set('Authorization', 'Bearer unverified-user')
        .expect(403);
    });

    it('lets a verified user through', async () => {
      await request(server())
        .get('/gated')
        .set('Authorization', 'Bearer verified-user')
        .expect(200);
    });

    it('401s an anonymous caller', async () => {
      await request(server()).get('/gated').expect(401);
    });
  });
});
