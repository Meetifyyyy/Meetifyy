import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtGuard } from './jwt.guard';
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
    const reflector = new Reflector();
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key: any) => decorators.includes(key));
    (guard as any).reflector = reflector;
    return {
      getHandler: () => () => undefined,
      getClass: () => class {},
    } as any;
  };

  const enforce = (ctx: any) =>
    (guard as any).enforceLegalAcknowledgement(ctx, { id: USER_ID });

  beforeEach(() => {
    satisfied = true;
    guard = new JwtGuard({} as any, {} as any, new Reflector(), {
      isSatisfied: async () => satisfied,
    } as any);
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
      const err: any = await enforce(contextWith()).catch((e: any) => e);
      expect(err.getResponse()).toMatchObject({
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
      (guard as any).enforceLegalAcknowledgement(contextWith(), {}),
    ).resolves.toBeUndefined();
  });
});
