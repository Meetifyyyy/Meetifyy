// EmailService pulls in sanitize-html, whose ESM dependency Jest cannot parse.
jest.mock('../../email/email.service', () => ({ EmailService: jest.fn() }));

import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import { config } from '../../config';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import { AdminAuthService } from './admin-auth.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { EmailService } from '../../email/email.service';
import { stub } from '../../common/testing/stub';

/**
 * The three admin tokens (pending, access, refresh) as the server reads them
 * back. Each is signed by this service with its own secret, so the claims are
 * trusted; what is tested is that a token missing a claim, or carrying the
 * wrong step, is refused as a 401 rather than reaching Prisma or `crypto` as
 * `undefined`.
 */
const ACCESS = 'admin-access-spec-secret';
const REFRESH = 'admin-refresh-spec-secret';
const PENDING = 'admin-pending-spec-secret';

const ADMIN = {
  id: 'admin-1',
  email: 'root@meetifyy.app',
  name: 'Root',
  isActive: true,
  totpEnabled: false,
};

beforeEach(() => {
  jest.replaceProperty(config.auth.admin, 'accessSecret', ACCESS);
  jest.replaceProperty(config.auth.admin, 'refreshSecret', REFRESH);
  jest.replaceProperty(config.auth.admin, 'pendingSecret', PENDING);
});

afterEach(() => jest.restoreAllMocks());

/** A guard whose database knows one live session, owned by `adminId`. */
function makeGuardForSession(adminId: string) {
  const prisma = {
    superAdmin: {
      findUnique: jest.fn().mockResolvedValue({ ...ADMIN, id: adminId }),
    },
    superAdminSession: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'sess-1',
        revoked: false,
        expiresAt: new Date(Date.now() + 60_000),
        adminId,
      }),
      update: jest.fn().mockResolvedValue(undefined),
    },
  };
  return {
    guard: new AdminJwtGuard({} as ConfigService, stub<PrismaService>(prisma)),
  };
}

function guardContext(accessToken: string) {
  const request = {
    method: 'GET',
    headers: {},
    cookies: { admin_access: accessToken },
  };
  return stub<ExecutionContext>({
    switchToHttp: () => ({ getRequest: () => request }),
  });
}

describe('AdminJwtGuard', () => {
  const liveSession = {
    id: 'sess-1',
    revoked: false,
    expiresAt: new Date(Date.now() + 60_000),
    adminId: ADMIN.id,
  };

  const makeGuard = () => {
    const prisma = {
      superAdmin: { findUnique: jest.fn().mockResolvedValue(ADMIN) },
      superAdminSession: {
        findUnique: jest.fn().mockResolvedValue(liveSession),
        update: jest.fn().mockResolvedValue(undefined),
      },
    };
    const guard = new AdminJwtGuard(
      {} as ConfigService,
      stub<PrismaService>(prisma),
    );
    return { guard, prisma };
  };

  const contextFor = (request: Record<string, unknown>) =>
    stub<ExecutionContext>({
      switchToHttp: () => ({ getRequest: () => request }),
    });

  const request = (token: string, extra: Record<string, unknown> = {}) => ({
    method: 'GET',
    headers: {},
    cookies: { admin_access: token },
    ...extra,
  });

  it('attaches the admin and session for a valid token', async () => {
    const { guard } = makeGuard();
    const req: Record<string, unknown> = request(
      jwt.sign({ sub: ADMIN.id, sessionId: 'sess-1' }, ACCESS),
    );

    await expect(guard.canActivate(contextFor(req))).resolves.toBe(true);
    expect(req.admin).toEqual(ADMIN);
    expect(req.adminSession).toEqual(liveSession);
  });

  it('refuses a token without a session id before touching the database', async () => {
    const { guard, prisma } = makeGuard();
    const req = request(jwt.sign({ sub: ADMIN.id }, ACCESS));

    await expect(guard.canActivate(contextFor(req))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.superAdmin.findUnique).not.toHaveBeenCalled();
  });

  it('refuses a token signed with another secret', async () => {
    const { guard } = makeGuard();
    const req = request(
      jwt.sign({ sub: ADMIN.id, sessionId: 'sess-1' }, 'not-the-secret'),
    );

    await expect(guard.canActivate(contextFor(req))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('refuses an access token signed with any algorithm but HS256', async () => {
    const { guard } = makeGuard();
    const hs384 = jwt.sign({ sub: ADMIN.id, sessionId: 'sess-1' }, ACCESS, {
      algorithm: 'HS384',
    });

    await expect(
      guard.canActivate(contextFor(request(hs384))),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses a live session that belongs to a different admin', async () => {
    const { guard, prisma } = makeGuard();
    prisma.superAdminSession.findUnique.mockResolvedValue({
      ...liveSession,
      adminId: 'someone-else',
    });
    const req: Record<string, unknown> = request(
      jwt.sign({ sub: ADMIN.id, sessionId: 'sess-1' }, ACCESS),
    );

    await expect(guard.canActivate(contextFor(req))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(req.admin).toBeUndefined();
  });

  it('requires a matching CSRF token on a mutation', async () => {
    const { guard } = makeGuard();
    const token = jwt.sign({ sub: ADMIN.id, sessionId: 'sess-1' }, ACCESS);

    await expect(
      guard.canActivate(contextFor(request(token, { method: 'POST' }))),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      guard.canActivate(
        contextFor(
          request(token, {
            method: 'POST',
            headers: { 'x-csrf-token': 'c1' },
            cookies: { admin_access: token, admin_csrf: 'c1' },
          }),
        ),
      ),
    ).resolves.toBe(true);
  });
});

describe('AdminAuthService tokens', () => {
  const makeService = () => {
    const prisma = {
      superAdmin: { findUnique: jest.fn().mockResolvedValue(null) },
      superAdminSession: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const service = new AdminAuthService(
      stub<PrismaService>(prisma),
      {} as ConfigService,
      {} as EmailService,
    );
    return { service, prisma };
  };

  it('does not accept an OTP-step token at the TOTP step', async () => {
    const { service, prisma } = makeService();
    const otpStep = jwt.sign({ sub: ADMIN.id, step: 'OTP' }, PENDING);

    await expect(
      service.verifyTotp(
        { pendingToken: otpStep, totpCode: '000000' },
        'ip',
        'ua',
      ),
    ).rejects.toThrow('Invalid authentication step');
    expect(prisma.superAdmin.findUnique).not.toHaveBeenCalled();
  });

  it('looks up the admin the pending token names', async () => {
    const { service, prisma } = makeService();
    const totpStep = jwt.sign({ sub: ADMIN.id, step: 'TOTP' }, PENDING);

    // No such admin in the stub, so it stops at the account check.
    await expect(
      service.verifyTotp(
        { pendingToken: totpStep, totpCode: '000000' },
        'ip',
        'ua',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.superAdmin.findUnique).toHaveBeenCalledWith({
      where: { id: ADMIN.id },
    });
  });

  describe('refresh', () => {
    const tokenKey = 'raw-refresh-key';
    const liveSession = (adminId: string) => ({
      id: 'sess-1',
      adminId,
      revoked: false,
      expiresAt: new Date(Date.now() + 60_000),
      refreshHash: crypto.createHash('sha256').update(tokenKey).digest('hex'),
      admin: { ...ADMIN, id: adminId },
    });
    const refreshTokenFor = (sub: string) =>
      jwt.sign({ sub, sessionId: 'sess-1', tokenKey }, REFRESH);

    const makeRefreshService = (session: object) => {
      const prisma = {
        superAdminSession: {
          findUnique: jest.fn().mockResolvedValue(session),
          update: jest.fn().mockResolvedValue({}),
          updateMany: jest.fn().mockResolvedValue({}),
        },
        securityEvent: { create: jest.fn().mockResolvedValue({}) },
      };
      return new AdminAuthService(
        stub<PrismaService>(prisma),
        {} as ConfigService,
        {} as EmailService,
      );
    };

    it('issues HS256 tokens that AdminJwtGuard then accepts', async () => {
      const service = makeRefreshService(liveSession(ADMIN.id));
      const { accessToken, refreshToken } = await service.refreshTokens(
        refreshTokenFor(ADMIN.id),
        'ip',
        'ua',
      );

      for (const token of [accessToken, refreshToken]) {
        expect(jwt.decode(token, { complete: true })?.header.alg).toBe('HS256');
      }
      const { guard } = makeGuardForSession(ADMIN.id);
      await expect(guard.canActivate(guardContext(accessToken))).resolves.toBe(
        true,
      );
    });

    it("refuses a refresh token naming a different admin than the session's", async () => {
      const service = makeRefreshService(liveSession('someone-else'));

      await expect(
        service.refreshTokens(refreshTokenFor(ADMIN.id), 'ip', 'ua'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  it('answers a refresh token without its key with 401, not a crash', async () => {
    const { service, prisma } = makeService();
    const keyless = jwt.sign({ sub: ADMIN.id, sessionId: 'sess-1' }, REFRESH);

    await expect(
      service.refreshTokens(keyless, 'ip', 'ua'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.superAdminSession.findUnique).not.toHaveBeenCalled();
  });
});
