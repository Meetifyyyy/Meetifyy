import { ReportTargetType } from '@prisma/client';
import { ReportTargetResolver } from './report-target.resolver';
import { stub } from '../common/testing/stub';
import type { PrismaService } from '../prisma/prisma.service';
import type {
  ActivityAuthorizationService,
  UserAuthContext,
} from '../activities/activity-authorization.service';
import type { AffiliationGateRow } from '../common/campus/campus-access.service';
import { affiliatedWith } from '../common/campus/testing/affiliation.fixture';

/**
 * The ACTIVITY existence check is scoped to what the reporter may see, and
 * COLLEGE_ONLY visibility follows the ACTIVE affiliation, never the
 * `User.collegeId` mirror (which outlives a removed or revoked email).
 */
describe('ReportTargetResolver — activity visibility context', () => {
  const build = (affiliation: AffiliationGateRow | null) => {
    const accessWhere = jest.fn((_u: UserAuthContext | null) => ({}));
    const resolver = new ReportTargetResolver(
      stub<PrismaService>({
        user: {
          findUnique: jest.fn(() =>
            Promise.resolve({
              id: 'reporter',
              collegeId: 'college-a',
              collegeAffiliation: affiliation,
            }),
          ),
        },
        crewActivity: {
          findFirst: jest.fn(() => Promise.resolve({ id: 'a1' })),
        },
      }),
      stub<ActivityAuthorizationService>({ accessWhere }),
    );
    return { resolver, accessWhere };
  };

  it('passes the active affiliation college', async () => {
    const { resolver, accessWhere } = build(affiliatedWith('college-b'));
    await resolver.exists(ReportTargetType.ACTIVITY, 'a1', 'reporter');
    expect(accessWhere).toHaveBeenCalledWith({
      id: 'reporter',
      collegeId: 'college-b',
    });
  });

  it('passes no college for a revoked affiliation, whatever the mirror says', async () => {
    const { resolver, accessWhere } = build(
      affiliatedWith('college-a', { revokedAt: new Date() }),
    );
    await resolver.exists(ReportTargetType.ACTIVITY, 'a1', 'reporter');
    expect(accessWhere).toHaveBeenCalledWith({
      id: 'reporter',
      collegeId: null,
    });
  });
});

/**
 * A report view is a read the audit interceptor never records, so the
 * confession preview must not carry the account behind the handle. That
 * identity is behind the reasoned, audited reveal-author action.
 */
describe('ReportTargetResolver — confession preview', () => {
  it('selects the handle but not the author account', async () => {
    const findUnique = jest.fn((_args: { select: Record<string, unknown> }) =>
      Promise.resolve({ id: 'c1', profile: { handle: 'ghost' } }),
    );
    const resolver = new ReportTargetResolver(
      stub<PrismaService>({ confession: { findUnique } }),
      stub<ActivityAuthorizationService>(),
    );

    await resolver.resolveAndFetch(ReportTargetType.CONFESSION, 'c1');

    const { select } = findUnique.mock.calls[0][0];
    expect(select.profile).toEqual({ select: { handle: true } });
    expect(JSON.stringify(select)).not.toMatch(/user|username|displayName/);
  });
});
