import { Test, TestingModule } from '@nestjs/testing';
import {
  BlockedContactsController,
  BlocksController,
} from './blocked-contacts.controller';
import { UsersService } from './users.service';
import { JwtGuard } from '../common/guards/jwt.guard';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';

/**
 * A request carrying only what these controllers actually read off it — the
 * JWT subject. Building the full AuthenticatedUser here would assert nothing
 * extra and hide which field the controller depends on.
 */
const asRequest = (id: string) =>
  ({ user: { id } }) as unknown as AuthenticatedRequest;

/**
 * The blocked list and the unblock route are the two endpoints that could leak
 * one user's block relationships to another, so their contract is asserted
 * directly rather than inferred from the service they call.
 */
describe('Blocked contacts endpoints', () => {
  let blockedContacts: BlockedContactsController;
  let blocks: BlocksController;
  let usersService: Record<string, jest.Mock>;

  beforeEach(async () => {
    usersService = {
      getBlockedContacts: jest.fn(async () => ({
        contacts: [],
        hasMore: false,
        nextOffset: null,
      })),
      unblockUser: jest.fn(async () => ({ success: true, blocked: false })),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BlockedContactsController, BlocksController],
      providers: [{ provide: UsersService, useValue: usersService }],
    })
      // The guard's real implementation needs Supabase; its presence is asserted
      // separately via the route metadata below.
      .overrideGuard(JwtGuard)
      .useValue({ canActivate: () => true })
      .compile();

    blockedContacts = module.get(BlockedContactsController);
    blocks = module.get(BlocksController);
  });

  describe('GET /api/settings/blocked-contacts', () => {
    it('reads the list for the JWT subject, never a caller-supplied id', async () => {
      await blockedContacts.getBlockedContacts(asRequest('alice'));

      expect(usersService.getBlockedContacts).toHaveBeenCalledWith(
        'alice',
        20,
        0,
      );
    });

    it('defaults to 20 per page', async () => {
      await blockedContacts.getBlockedContacts(asRequest('alice'));
      expect(usersService.getBlockedContacts.mock.calls[0][1]).toBe(20);
    });

    it('passes through pagination parameters', async () => {
      await blockedContacts.getBlockedContacts(asRequest('alice'), '15', '40');
      expect(usersService.getBlockedContacts).toHaveBeenCalledWith(
        'alice',
        15,
        40,
      );
    });

    it('falls back to defaults on unparseable pagination input', async () => {
      await blockedContacts.getBlockedContacts(
        asRequest('alice'),
        'abc',
        'xyz',
      );
      expect(usersService.getBlockedContacts).toHaveBeenCalledWith(
        'alice',
        20,
        0,
      );
    });

    it('is protected by JwtGuard', () => {
      const guards = Reflect.getMetadata(
        '__guards__',
        BlockedContactsController.prototype.getBlockedContacts,
      );
      expect(guards?.[0]).toBe(JwtGuard);
    });
  });

  describe('DELETE /api/blocks/:blockedUserId', () => {
    it('unblocks only on behalf of the JWT subject', async () => {
      await blocks.unblock('bob', asRequest('alice'));

      // The blocker is the authenticated user; the route has no parameter that
      // could name a different one, so a pair the caller is not part of is
      // unreachable rather than merely rejected.
      expect(usersService.unblockUser).toHaveBeenCalledWith('alice', 'bob');
    });

    it('performs no restore side effects — unblock is deliberately inert', async () => {
      await blocks.unblock('bob', asRequest('alice'));

      // Everything the endpoint does happens inside unblockUser, which is
      // asserted in blocking.spec.ts to remove only the block row. Nothing else
      // is invoked here, so there is no path that could re-follow or re-match.
      expect(
        Object.keys(usersService).filter(
          (k) => usersService[k].mock.calls.length,
        ),
      ).toEqual(['unblockUser']);
    });

    it('is protected by JwtGuard', () => {
      const guards = Reflect.getMetadata(
        '__guards__',
        BlocksController.prototype.unblock,
      );
      expect(guards?.[0]).toBe(JwtGuard);
    });
  });
});
