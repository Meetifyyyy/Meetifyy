// EmailService pulls in sanitize-html, whose ESM dependency Jest cannot parse.
jest.mock('../../email/email.service', () => ({ EmailService: jest.fn() }));

import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { config } from '../../config';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import { AdminAuthService } from './admin-auth.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { EmailService } from '../../email/email.service';

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
      prisma as unknown as PrismaService,
    );
    return { guard, prisma };
  };

  const contextFor = (request: Record<string, unknown>) =>
    ({
      switchToHttp: () => ({ getRequest: () => request }),
    }) as unknown as ExecutionContext;

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
      prisma as unknown as PrismaService,
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

  it('answers a refresh token without its key with 401, not a crash', async () => {
    const { service, prisma } = makeService();
    const keyless = jwt.sign({ sub: ADMIN.id, sessionId: 'sess-1' }, REFRESH);

    await expect(
      service.refreshTokens(keyless, 'ip', 'ua'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.superAdminSession.findUnique).not.toHaveBeenCalled();
  });
});
