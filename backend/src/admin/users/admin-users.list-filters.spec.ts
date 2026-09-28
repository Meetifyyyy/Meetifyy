import { BadRequestException } from '@nestjs/common';
import { AdminUsersService } from './admin-users.service';

/**
 * The admin user list's `accountStatus` filter is a query string handed to
 * Prisma as the AccountStatus enum. An unknown value used to fail the request
 * with a 500 (pending item A4). The admin portal's values (UsersPage.tsx),
 * including '' for "All", still work.
 */
describe('AdminUsersService.listUsers — accountStatus filter', () => {
  const build = () => {
    const findMany = jest.fn(() => Promise.resolve([]));
    const service = Object.create(
      AdminUsersService.prototype,
    ) as AdminUsersService;
    Object.assign(service, {
      prisma: {
        user: {
          count: jest.fn(() => Promise.resolve(0)),
          findMany,
          groupBy: jest.fn(() => Promise.resolve([])),
        },
      },
    });
    return { service, findMany };
  };

  it.each([undefined, '', 'ACTIVE', 'SUSPENDED', 'BANNED', 'PENDING_DELETION'])(
    'serves %p',
    async (accountStatus) => {
      const { service } = build();
      await expect(service.listUsers({ accountStatus })).resolves.toBeDefined();
    },
  );

  it('refuses an unknown status before the database is asked', async () => {
    const { service, findMany } = build();
    await expect(
      service.listUsers({ accountStatus: 'active-ish' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(findMany).not.toHaveBeenCalled();
  });
});
