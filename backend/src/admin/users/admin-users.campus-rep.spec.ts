import { BadRequestException } from '@nestjs/common';
import { AdminUsersService } from './admin-users.service';
import { stub } from '../../common/testing/stub';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SupabaseService } from '../../supabase/supabase.service';
import type { UserSessionService } from '../../auth/session/user-session.service';
import type { CampusAffiliationService } from '../../campus-affiliation/campus-affiliation.service';
import type { AffiliationGateRow } from '../../common/campus/campus-access.service';
import { affiliatedWith } from '../../common/campus/testing/affiliation.fixture';

/**
 * Assigning a Campus Representative requires an ACTIVE affiliation: the
 * campus-event writes a rep makes are scoped to it. The `User.collegeId`
 * mirror (kept after removal or revocation) used to qualify a user here.
 */
describe('AdminUsersService.setCampusRep — campus from the affiliation', () => {
  const build = (affiliation: AffiliationGateRow | null) => {
    const findFirst = jest.fn(() => Promise.resolve(null));
    const update = jest.fn(() => Promise.resolve({ id: 'u1' }));
    const tx = {
      user: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            id: 'u1',
            isCampusRep: false,
            // The mirror still names a college; it must not count.
            collegeId: 'college-a',
            collegeAffiliation: affiliation,
          }),
        ),
        findFirst,
        update,
      },
    };
    const service = new AdminUsersService(
      stub<PrismaService>({
        $transaction: jest.fn((fn: (t: typeof tx) => Promise<unknown>) =>
          fn(tx),
        ),
      }),
      stub<SupabaseService>(),
      stub<CampusAffiliationService>(),
      stub<UserSessionService>(),
    );
    return { service, findFirst, update };
  };

  it('refuses a user whose affiliation was revoked', async () => {
    const { service, update } = build(
      affiliatedWith('college-a', { revokedAt: new Date() }),
    );
    await expect(service.setCampusRep('u1', true)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('refuses a user with only the mirror', async () => {
    const { service } = build(null);
    await expect(service.setCampusRep('u1', true)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('assigns a user with an active affiliation, checking that campus', async () => {
    const { service, findFirst, update } = build(affiliatedWith('college-a'));
    await expect(service.setCampusRep('u1', true)).resolves.toMatchObject({
      success: true,
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          collegeAffiliation: {
            is: { collegeId: 'college-a', revokedAt: null },
          },
        }) as unknown,
      }),
    );
    expect(update).toHaveBeenCalled();
  });
});
