import { ForbiddenException } from '@nestjs/common';
import { CampusAccessService } from './campus-access.service';
import { UsersController } from '../../users/users.controller';
import { CommunitiesController } from '../../communities/communities.controller';
import { CampusEventsController } from '../../campus-events/campus-events.controller';
import type { UsersService } from '../../users/users.service';
import type { CommunitiesService } from '../../communities/communities.service';
import type { CampusEventsService } from '../../campus-events/campus-events.service';
import type { AccountDeletionService } from '../../account-deletion/account-deletion.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type {
  AuthenticatedRequest,
  AuthenticatedUser,
} from '../types/authenticated-request';
import { stub } from '../testing/stub';
import { affiliatedWith } from './testing/affiliation.fixture';

/**
 * Campus surfaces are gated by a verified college email and scoped to the
 * affiliation's college — never the `User.collegeId` mirror, never a request
 * value. See docs/college-affiliation.md.
 */
describe('campus gating', () => {
  const ME = 'me';
  let affiliation: ReturnType<typeof affiliatedWith>;
  let access: CampusAccessService;

  beforeEach(() => {
    affiliation = null;
    access = new CampusAccessService(
      stub<PrismaService>({
        collegeAffiliation: {
          findUnique: jest.fn(() => Promise.resolve(affiliation)),
        },
      }),
    );
  });

  const req = stub<AuthenticatedRequest>({ user: { id: ME } });
  const user = stub<AuthenticatedUser>({ id: ME });

  describe('GET /api/users/campus and /directory', () => {
    const getCampusUsers = jest.fn(() => Promise.resolve([]));
    const getDirectory = jest.fn(() =>
      Promise.resolve({ users: [], nextCursor: undefined }),
    );
    const controller = () =>
      new UsersController(
        stub<UsersService>({ getCampusUsers, getDirectory }),
        stub<AccountDeletionService>({}),
        access,
      );

    it('403s campus_affiliation_required without an affiliation', async () => {
      const err = await controller()
        .getCampusUsers(req)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).getResponse()).toMatchObject({
        code: 'campus_affiliation_required',
      });
      await expect(controller().getDirectory(req)).rejects.toThrow(
        ForbiddenException,
      );
      expect(getCampusUsers).not.toHaveBeenCalled();
    });

    it('403s a revoked affiliation and one whose college was closed', async () => {
      affiliation = affiliatedWith('c1', { revokedAt: new Date() });
      await expect(controller().getCampusUsers(req)).rejects.toThrow(
        ForbiddenException,
      );
      affiliation = affiliatedWith('c1', {
        college: { isActive: true, status: 'DISABLED', deletedAt: null },
      });
      await expect(controller().getDirectory(req)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("scopes to the affiliation's college", async () => {
      affiliation = affiliatedWith('c1');
      await controller().getCampusUsers(req);
      expect(getCampusUsers).toHaveBeenCalledWith(ME, 100, 0, {
        collegeId: 'c1',
      });
      await controller().getDirectory(req);
      expect(getDirectory).toHaveBeenCalledWith(
        ME,
        expect.objectContaining({ collegeId: 'c1' }),
      );
    });
  });

  describe('GET /api/communities/campus', () => {
    const getCampusCommunities = jest.fn(() => Promise.resolve([]));
    const controller = () =>
      new CommunitiesController(
        stub<CommunitiesService>({ getCampusCommunities }),
        access,
      );

    it('answers [] without an affiliation, as it always did without a campus', async () => {
      await expect(controller().getCampusCommunities(user)).resolves.toEqual(
        [],
      );
      expect(getCampusCommunities).not.toHaveBeenCalled();
    });

    it("passes the affiliation's college", async () => {
      affiliation = affiliatedWith('c1');
      await controller().getCampusCommunities(user);
      expect(getCampusCommunities).toHaveBeenCalledWith(
        ME,
        30,
        0,
        undefined,
        'c1',
      );
    });
  });

  describe('GET /api/campus-events', () => {
    const listByScope = jest.fn(() =>
      Promise.resolve({ events: [], nextCursor: undefined }),
    );
    const controller = () =>
      new CampusEventsController(
        stub<CampusEventsService>({ listByScope }),
        access,
      );

    it('403s without an affiliation', async () => {
      await expect(controller().list(user)).rejects.toThrow(ForbiddenException);
    });

    it("lists the affiliation's campus", async () => {
      affiliation = affiliatedWith('c1');
      await controller().list(user);
      expect(listByScope).toHaveBeenCalledWith(
        ME,
        'upcoming',
        expect.objectContaining({ campusId: 'c1' }),
      );
    });
  });
});
