import { describe, beforeEach, it, expect, jest } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { JwtGuard, SUSPENDED_ERROR_CODE } from './jwt.guard';
import { ALLOW_SUSPENDED_KEY } from '../decorators/allow-suspended.decorator';
import { stub } from '../testing/stub';
import { routeContext } from './testing/jwt-guard.fixture';
import type { AuthenticatedUser } from '../types/authenticated-request';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SupabaseService } from '../../supabase/supabase.service';
import type { LegalConsentService } from '../legal/legal-consent.service';

/**
 * The suspension gate.
 *
 * A suspended account keeps a valid session on purpose, so the thing that
 * actually stops it using the product is this guard — not the screen the client
 * chooses to render. These cover the three outcomes that matter: a suspended
 * account is refused everywhere by default, is let through on the handful of
 * routes that serve the appeal flow, and an active account is untouched.
 */
describe('JwtGuard — suspension enforcement', () => {
  const USER_ID = 'user-1';

  let prisma: { user: { findUnique: jest.Mock<() => Promise<unknown>> } };
  let reflector: Reflector;
  let guard: JwtGuard;

  /** A context whose handler is, or is not, marked @AllowSuspended(). */
  const contextFor = (allowSuspended: boolean) => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key: unknown) =>
        key === ALLOW_SUSPENDED_KEY ? allowSuspended : undefined,
      );
    return routeContext({ headers: {} });
  };

  const enforce = (context: ExecutionContext) =>
    guard['enforceAccountStatus'](
      context,
      stub<AuthenticatedUser>({ id: USER_ID }),
    );

  beforeEach(() => {
    JwtGuard.clearAccountStatus(USER_ID);
    prisma = { user: { findUnique: jest.fn<() => Promise<unknown>>() } };
    reflector = new Reflector();
    guard = new JwtGuard(
      stub<SupabaseService>({ isConfigured: true }),
      stub<PrismaService>(prisma),
      reflector,
      // The legal gate has its own spec; a service that always reports
      // "satisfied" keeps this one about suspension alone.
      stub<LegalConsentService>({ isSatisfied: () => Promise.resolve(true) }),
    );
  });

  it('refuses a suspended account on an ordinary route', async () => {
    prisma.user.findUnique.mockResolvedValue({ accountStatus: 'SUSPENDED' });

    await expect(enforce(contextFor(false))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('tells the client why, so it can show the suspension screen', async () => {
    prisma.user.findUnique.mockResolvedValue({ accountStatus: 'SUSPENDED' });

    await expect(enforce(contextFor(false))).rejects.toMatchObject({
      response: { code: SUSPENDED_ERROR_CODE },
    });
  });

  it('lets a suspended account through on an @AllowSuspended route', async () => {
    prisma.user.findUnique.mockResolvedValue({ accountStatus: 'SUSPENDED' });

    await expect(enforce(contextFor(true))).resolves.toBeUndefined();
  });

  it('does not touch an active account', async () => {
    prisma.user.findUnique.mockResolvedValue({ accountStatus: 'ACTIVE' });

    await expect(enforce(contextFor(false))).resolves.toBeUndefined();
  });

  it('reads the status once per user per window, then serves it from cache', async () => {
    prisma.user.findUnique.mockResolvedValue({ accountStatus: 'ACTIVE' });

    await enforce(contextFor(false));
    await enforce(contextFor(false));
    await enforce(contextFor(false));

    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it('re-reads immediately once the cache is cleared by an admin action', async () => {
    prisma.user.findUnique.mockResolvedValue({ accountStatus: 'ACTIVE' });
    await enforce(contextFor(false));

    // An admin suspends the account; admin-users.service clears the entry.
    prisma.user.findUnique.mockResolvedValue({ accountStatus: 'SUSPENDED' });
    JwtGuard.clearAccountStatus(USER_ID);

    await expect(enforce(contextFor(false))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('fails open when the status lookup errors, so a database blip cannot lock everyone out', async () => {
    prisma.user.findUnique.mockRejectedValue(new Error('connection lost'));

    await expect(enforce(contextFor(false))).resolves.toBeUndefined();
  });
});
