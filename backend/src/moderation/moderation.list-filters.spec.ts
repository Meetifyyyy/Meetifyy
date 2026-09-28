import { BadRequestException } from '@nestjs/common';
import { ModerationService } from './moderation.service';

/**
 * The admin report list's `status`, `priority` and `targetType` filters are
 * query strings handed to Prisma as enums. An unknown value used to reach
 * Prisma and fail the request with a 500 (pending item A4). The values the
 * admin portal sends (ReportsPage.tsx) — including '' for "all" — still work.
 */
describe('ModerationService.listReports — enum filters', () => {
  const build = () => {
    const findMany = jest.fn(() => Promise.resolve([]));
    const service = Object.create(
      ModerationService.prototype,
    ) as ModerationService;
    Object.assign(service, {
      prisma: {
        report: { count: jest.fn(() => Promise.resolve(0)), findMany },
      },
    });
    return { service, findMany };
  };

  it.each([
    {},
    { status: '', priority: '' },
    { status: 'PENDING', priority: 'CRITICAL' },
    { status: 'UNDER_REVIEW', priority: 'LOW' },
    { targetType: 'POST' },
  ])('serves %j', async (query) => {
    const { service } = build();
    await expect(service.listReports(query)).resolves.toBeDefined();
  });

  it('passes a valid filter through to the query', async () => {
    const { service, findMany } = build();
    await service.listReports({ status: 'RESOLVED', targetType: 'COMMENT' });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'RESOLVED', targetType: 'COMMENT' },
      }),
    );
  });

  it.each([
    { status: 'resolved-ish' },
    { priority: 'URGENT' },
    { targetType: 'SPACESHIP' },
  ])('refuses %j before the database is asked', async (query) => {
    const { service, findMany } = build();
    await expect(service.listReports(query)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(findMany).not.toHaveBeenCalled();
  });
});
