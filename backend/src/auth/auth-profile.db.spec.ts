import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService } from '../supabase/supabase.service';
import { DefaultAssetsService } from '../uploads/default-assets.service';
import { DomainValidatorService } from '../common/services/domain-validator.service';
import { RedisService } from '../redis/redis.service';
import { legalConsentMockProvider } from '../common/legal/testing/legal-consent.mock';

/**
 * The session profile's follower and following counts against a real
 * Postgres (ID-16): counted by the profile page's own rules, so the numbers
 * the app shows from the session agree with the ones on the profile.
 *
 * Needs a disposable database with every migration applied, named in BOTH
 * `DATABASE_URL` and `AUTH_PROFILE_TEST_DATABASE_URL`, on localhost. Skipped
 * otherwise, so it can never run against a shared database.
 */
const TEST_URL = process.env.AUTH_PROFILE_TEST_DATABASE_URL ?? '';
const runnable =
  TEST_URL !== '' &&
  process.env.DATABASE_URL === TEST_URL &&
  /@(127\.0\.0\.1|localhost):\d+\//.test(TEST_URL);
const describeDb = runnable ? describe : describe.skip;

describeDb('Session profile counts (database)', () => {
  let prisma: PrismaService;
  let service: AuthService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const module = await Test.createTestingModule({
      providers: [
        legalConsentMockProvider(),
        AuthService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: SupabaseService,
          useValue: { isConfigured: true, client: {} },
        },
        { provide: DefaultAssetsService, useValue: { refFor: () => null } },
        { provide: DomainValidatorService, useValue: {} },
        { provide: RedisService, useValue: undefined },
      ],
    }).compile();
    service = module.get(AuthService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const user = async (
    over: { deletedAt?: Date; accountStatus?: 'ACTIVE' | 'SUSPENDED' } = {},
  ) => {
    const id = randomUUID();
    await prisma.user.create({
      data: {
        id,
        username: `p_${id.slice(0, 8)}`,
        displayName: 'P',
        email: `${id}@example.test`,
        ...over,
      },
    });
    return id;
  };

  it('counts active, unblocked people both ways, and lists no followers', async () => {
    const me = await user();
    const active = await user();
    const deleted = await user({ deletedAt: new Date() });
    const suspended = await user({ accountStatus: 'SUSPENDED' });
    const iBlocked = await user();
    const blockedMe = await user();
    const others = [active, deleted, suspended, iBlocked, blockedMe];

    await prisma.follow.createMany({
      data: [
        ...others.map((id) => ({ followerId: id, followingId: me })),
        ...others.map((id) => ({ followerId: me, followingId: id })),
      ],
    });
    await prisma.block.createMany({
      data: [
        { blockerId: me, blockedId: iBlocked },
        { blockerId: blockedMe, blockedId: me },
      ],
    });

    const row = await service['queryProfileRow'](me);

    expect(row).toMatchObject({ followersCount: 1, followingCount: 1 });
    // The following list itself is unchanged: follow state reads it whole.
    expect(row?.followingList).toHaveLength(others.length);
    expect(row).not.toHaveProperty('followersList');
    expect(row).not.toHaveProperty('postBookmarkIds');
  });
});
