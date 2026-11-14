import { AcademicsService } from './academics.service';
import type { PrismaService } from '../prisma/prisma.service';
import { stub } from '../common/testing/stub';

/**
 * The public colleges list (ID-37) is loaded by every signup and directory
 * screen; it is read from the database at most once a minute per replica.
 */
describe('AcademicsService.getColleges', () => {
  it('reads once for callers within the minute', async () => {
    const findMany = jest.fn(() =>
      Promise.resolve([
        {
          id: 'c1',
          name: 'College',
          shortName: null,
          logoKey: null,
          domains: [{ domain: 'college.edu', isPrimary: true }],
        },
      ]),
    );
    const service = new AcademicsService(
      stub<PrismaService>({ college: { findMany } }),
    );

    const [a] = await Promise.all([
      service.getColleges(),
      service.getColleges(),
    ]);
    await service.getColleges();

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(a).toEqual([
      {
        id: 'c1',
        name: 'College',
        shortName: null,
        domains: ['college.edu'],
        logoUrl: null,
      },
    ]);
  });
});
