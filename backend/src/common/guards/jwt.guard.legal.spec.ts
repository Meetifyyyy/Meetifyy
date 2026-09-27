import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtGuard } from './jwt.guard';
import { stub } from '../testing/stub';
import { reflectorWith, routeContext } from './testing/jwt-guard.fixture';
import type { AuthenticatedUser } from '../types/authenticated-request';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SupabaseService } from '../../supabase/supabase.service';
import type { LegalConsentService } from '../legal/legal-consent.service';
import { ALLOW_PENDING_LEGAL_ACK_KEY } from '../decorators/allow-pending-legal-ack.decorator';
import { LEGAL_ACKNOWLEDGEMENT_REQUIRED_CODE } from '../legal/legal.constants';

/**
 * Mandatory legal acceptance, enforced server-side.
 *
 * This is the test that matters for the whole feature: the modal is only an
 * explanation, and a user who deletes it from the DOM, opens a second tab,
 * navigates with the back button or drives the REST API by hand has to land
 * here. Only routes explicitly marked `@AllowPendingLegalAck()` — the ones that
 * let the user READ the update and ACCEPT it — get through.
 */
describe('JwtGuard — mandatory legal acknowledgement', () => {
  const USER_ID = 'user-1';

  let guard: JwtGuard;
  let satisfied: boolean;

  const contextWith = (decorators: string[] = []) => {
    Object.assign(guard, { reflector: reflectorWith(decorators) });
    return routeContext();
  };

  const enforce = (ctx: ExecutionContext) =>
    guard['enforceLegalAcknowledgement'](
      ctx,
      stub<AuthenticatedUser>({ id: USER_ID }),
    );

  beforeEach(() => {
    satisfied = true;
    guard = new JwtGuard(
      stub<SupabaseService>(),
      stub<PrismaService>(),
      new Reflector(),
      stub<LegalConsentService>({
        isSatisfied: () => Promise.resolve(satisfied),
      }),
    );
  });

  it('lets a user who has accepted everything through any route', async () => {
    await expect(enforce(contextWith())).resolves.toBeUndefined();
  });

  describe('a user with an outstanding required version', () => {
    beforeEach(() => {
      satisfied = false;
    });

    it('is refused on an ordinary route', async () => {
      await expect(enforce(contextWith())).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('carries a machine-readable code so the client shows the consent flow', async () => {
      const err = await enforce(contextWith()).catch((e: unknown) => e);
      expect((err as HttpException).getResponse()).toMatchObject({
        code: LEGAL_ACKNOWLEDGEMENT_REQUIRED_CODE,
      });
    });

    /**
     * Without this the flow is unusable: the user cannot read the document they
     * are being asked to accept, and cannot post the acceptance.
     */
    it('reaches the routes that serve the acknowledgement itself', async () => {
      await expect(
        enforce(contextWith([ALLOW_PENDING_LEGAL_ACK_KEY])),
      ).resolves.toBeUndefined();
    });
  });

  /**
   * An anonymous caller has no acknowledgements and never will. Refusing here
   * would turn every unauthenticated request into a consent error instead of
   * the authentication error it actually is.
   */
  it('says nothing about a request carrying no user', async () => {
    satisfied = false;
    await expect(
      guard['enforceLegalAcknowledgement'](
        contextWith(),
        stub<AuthenticatedUser>({}),
      ),
    ).resolves.toBeUndefined();
  });
});
