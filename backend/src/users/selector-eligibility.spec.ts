import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { VerificationStatus } from '@prisma/client';
import { UsersService } from './users.service';
import { BlocksService } from './blocks.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationFactory } from '../notifications/notification.factory';
import { DomainEventService } from '../events/domain-event.service';
import { RedisService } from '../redis/redis.service';
import { PresenceService } from '../presence/presence.service';
import { AcademicsService } from '../academics/academics.service';
import { NOTIFICATIONS_QUEUE } from '../notifications/notifications.processor';
import { VerificationAccessService } from '../common/verification/verification-access.service';

/**
 * `/api/users/connections` is the recipient list behind every Invite selector
 * (Group Invite, Activity Invite). These tests pin that an unverified account
 * cannot come out of it, and that the reason it cannot is the QUERY.
 *
 * The distinction matters more than it looks. `take: limit` is applied by the
 * database, so a version that fetched fifty rows and filtered afterwards would
 * return short pages, and would eventually return an empty page while eligible
 * users still existed further down. It would also have written the unfiltered
 * rows into the Redis entry on the way past. Asserting on the `where` is what
 * distinguishes the two implementations; asserting on the returned array does
 * not.
 */
describe('UsersService — selector eligibility', () => {
  let service: UsersService;
  let findMany: jest.Mock;

  beforeEach(async () => {
    findMany = jest.fn().mockResolvedValue([]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: PrismaService,
          useValue: { user: { findMany, findUnique: jest.fn() } },
        },
        {
          provide: BlocksService,
          // Passes the where through untouched, so what the assertions see is
          // exactly what getConnections built.
          useValue: {
            injectBlockFilter: jest.fn(async (_id, where) => where),
            getExcludedUserIds: jest.fn().mockResolvedValue([]),
          },
        },
        { provide: NotificationsService, useValue: {} },
        { provide: NotificationFactory, useValue: {} },
        { provide: DomainEventService, useValue: { publish: jest.fn() } },
        // No Redis: a cache hit would short-circuit the query these tests are
        // about, and the caching behaviour is asserted separately below.
        { provide: RedisService, useValue: { getClient: () => null } },
        { provide: PresenceService, useValue: { getPresenceMany: jest.fn() } },
        AcademicsService,
        { provide: getQueueToken(NOTIFICATIONS_QUEUE), useValue: { add: jest.fn() } },
        VerificationAccessService,
      ],
    }).compile();

    service = moduleRef.get(UsersService);
    delete process.env.FEATURE_VERIFICATION_ENABLED;
  });

  afterEach(() => {
    delete process.env.FEATURE_VERIFICATION_ENABLED;
  });

  const whereOf = () => findMany.mock.calls[0][0].where;

  it('restricts the default list to verified accounts', () => {
    return service.getConnections('me').then(() => {
      expect(whereOf().verificationStatus).toBe(VerificationStatus.VERIFIED);
    });
  });

  it('keeps the restriction when a search term is supplied', async () => {
    await service.getConnections('me', 'john');
    expect(whereOf().verificationStatus).toBe(VerificationStatus.VERIFIED);
  });

  it('keeps it for an exact username, which is the case most likely to leak', async () => {
    // Searching the precise handle of an unverified account must return
    // nothing, even to someone who follows them or has an existing chat.
    await service.getConnections('me', 'john123');
    const where = whereOf();
    expect(where.verificationStatus).toBe(VerificationStatus.VERIFIED);
    // The search terms are an OR, and the status must sit OUTSIDE it. Inside,
    // a name match alone would satisfy the clause.
    expect(where.OR).toBeDefined();
    expect(JSON.stringify(where.OR)).not.toContain('verificationStatus');
  });

  it('applies it alongside the existing constraints rather than replacing them', async () => {
    await service.getConnections('me');
    const where = whereOf();
    expect(where.accountStatus).toBe('ACTIVE');
    expect(where.id).toEqual({ not: 'me' });
    expect(where.verificationStatus).toBe(VerificationStatus.VERIFIED);
  });

  it('constrains the query rather than the result, so pages stay full', async () => {
    await service.getConnections('me', '', 50);
    const args = findMany.mock.calls[0][0];
    // take and the predicate are in the same call: the database applies the
    // limit to already-eligible rows.
    expect(args.take).toBe(50);
    expect(args.where.verificationStatus).toBe(VerificationStatus.VERIFIED);
  });

  it('lifts the restriction when enforcement is disabled', async () => {
    process.env.FEATURE_VERIFICATION_ENABLED = 'false';
    await service.getConnections('me');
    expect(whereOf().verificationStatus).toBeUndefined();
  });
});

/**
 * The cache key had to change with the rule.
 *
 * Entries written by the previous build hold unverified users, and a 20s TTL
 * would have kept serving them across a deploy — a window in which the rule
 * simply did not apply, on the exact endpoint it was written for.
 */
describe('UsersService — connections cache', () => {
  it('reads and writes a versioned key', async () => {
    const get = jest.fn().mockResolvedValue(null);
    const setex = jest.fn().mockResolvedValue('OK');

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: { user: { findMany: jest.fn().mockResolvedValue([]) } } },
        {
          provide: BlocksService,
          useValue: {
            injectBlockFilter: jest.fn(async (_id, where) => where),
            getExcludedUserIds: jest.fn().mockResolvedValue([]),
          },
        },
        { provide: NotificationsService, useValue: {} },
        { provide: NotificationFactory, useValue: {} },
        { provide: DomainEventService, useValue: { publish: jest.fn() } },
        { provide: RedisService, useValue: { getClient: () => ({ get, setex }) } },
        { provide: PresenceService, useValue: {} },
        AcademicsService,
        { provide: getQueueToken(NOTIFICATIONS_QUEUE), useValue: { add: jest.fn() } },
        VerificationAccessService,
      ],
    }).compile();

    await moduleRef.get(UsersService).getConnections('me', 'john', 50);

    expect(get).toHaveBeenCalledWith('connections:v2:me:john:50');
    expect(setex.mock.calls[0][0]).toBe('connections:v2:me:john:50');
  });
});
