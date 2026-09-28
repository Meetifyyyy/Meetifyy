import { BadRequestException } from '@nestjs/common';
import { AdminCollegesService } from './admin-colleges.service';
import { stub } from '../../common/testing/stub';
import type { PrismaService } from '../../prisma/prisma.service';
import type { DomainValidatorService } from '../../common/services/domain-validator.service';

/**
 * The college directory's `status` filter is a query string handed to Prisma
 * as a `CollegeStatus` enum. An unknown value used to reach Prisma and fail
 * the whole request with a 500 (pending item A4); it is refused as a 400 now.
 * The values the admin portal sends — and the service's own `DELETED` — work
 * as before.
 */
describe('AdminCollegesService.listColleges — status filter', () => {
  const build = () => {
    const findMany = jest.fn(() => Promise.resolve([]));
    const service = new AdminCollegesService(
      stub<PrismaService>({
        college: {
          count: jest.fn(() => Promise.resolve(0)),
          findMany,
          groupBy: jest.fn(() => Promise.resolve([])),
        },
        collegeDomain: { count: jest.fn(() => Promise.resolve(0)) },
        user: { count: jest.fn(() => Promise.resolve(0)) },
      }),
      stub<DomainValidatorService>({ normalizeDomain: (d: string) => d }),
    );
    return { service, findMany };
  };

  it.each([undefined, '', 'APPROVED', 'PENDING', 'DISABLED', 'DELETED'])(
    'serves the filter %p',
    async (status) => {
      const { service } = build();
      await expect(service.listColleges({ status })).resolves.toBeDefined();
    },
  );

  it('refuses an unknown status before it reaches the database', async () => {
    const { service, findMany } = build();
    await expect(
      service.listColleges({ status: 'approved-ish' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(findMany).not.toHaveBeenCalled();
  });
});
