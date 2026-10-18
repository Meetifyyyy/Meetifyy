import { AuthService, clearAuthSyncCacheLocal } from './auth.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { SupabaseService } from '../supabase/supabase.service';
import type { DomainValidatorService } from '../common/services/domain-validator.service';
import type { DefaultAssetsService } from '../uploads/default-assets.service';
import { createLegalConsentMock } from '../common/legal/testing/legal-consent.mock';
import { stub } from '../common/testing/stub';

/**
 * The first sync of a brand-new account.
 *
 * It used to answer with the Prisma row it had just written: every column,
 * purge bookkeeping included, and none of `meta`. It now reads the row back through the same query and builder every
 * later sync uses, so the two responses cannot drift apart.
 */
const USER_ID = 'user-new';

/** The row the profile query returns once the account exists. */
const CREATED_ROW = {
  id: USER_ID,
  username: 'ravi',
  displayName: 'Ravi',
  email: 'ravi@example.edu',
  bio: null,
  course: null,
  branch: null,
  passingYear: null,
  batchYear: null,
  location: null,
  createdAt: new Date('2026-09-24T00:00:00Z'),
  updatedAt: new Date('2026-09-24T00:00:00Z'),
  avatar: null,
  avatarMediaId: null,
  collegeEmail: 'ravi@example.edu',
  collegeId: 'college-1',
  cover: null,
  coverMediaId: null,
  verificationStatus: 'UNVERIFIED',
  birthday: new Date('2006-01-01'),
  interests: [],
  profileCompleted: false,
  accountStatus: 'ACTIVE',
  deletedAt: null,
  role: 'Student',
  canPost: true,
  canMessage: true,
  canActivity: true,
  isCampusRep: false,
  college_id: 'college-1',
  college_name: 'Example College',
  settings_id: 's1',
  emailNotifs: true,
  pushNotifs: true,
  privateProfile: false,
  showOnlineStatus: true,
  showLastSeen: true,
  whoCanSeeOnline: 'everyone',
  whoCanSeeLastSeen: 'everyone',
  readReceipts: true,
  followingList: [],
  followersList: [],
  postBookmarkIds: [],
  activityBookmarkIds: [],
  unreadNotifCount: 0,
};

const VERIFIED_SIGNUP = {
  id: USER_ID,
  email: 'ravi@example.edu',
  email_confirmed_at: '2026-09-24T00:00:00Z',
  user_metadata: {
    username: 'ravi',
    firstName: 'Ravi',
    birthday: '2006-01-01',
  },
};

describe('AuthService.syncProfile — a new account', () => {
  let queryRaw: jest.Mock;
  let upsert: jest.Mock;

  const build = () => {
    const prisma = {
      $queryRaw: queryRaw,
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert,
        update: jest.fn().mockResolvedValue({}),
      },
    };
    return new AuthService(
      stub<PrismaService>(prisma),
      stub<SupabaseService>({ isConfigured: true, client: {} }),
      stub<DomainValidatorService>({
        validateDomain: jest.fn().mockResolvedValue({
          isValid: true,
          info: { collegeId: 'college-1', collegeName: 'Example College' },
        }),
      }),
      stub<DefaultAssetsService>({ refFor: () => null }),
      createLegalConsentMock(),
    );
  };

  beforeEach(() => {
    clearAuthSyncCacheLocal();
    upsert = jest.fn().mockResolvedValue({ id: USER_ID, username: 'ravi' });
    queryRaw = jest
      .fn()
      .mockResolvedValueOnce([]) // no row yet: this is a new account
      .mockResolvedValue([{ ...CREATED_ROW }]); // read back after the upsert
  });

  afterEach(() => clearAuthSyncCacheLocal());

  it('creates the row once and reads it back through the profile query', async () => {
    await build().syncProfile(VERIFIED_SIGNUP);

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it('answers with the curated profile, not the database row', async () => {
    const profile = await build().syncProfile(VERIFIED_SIGNUP);

    // Kept, always false, for installed apps' frozen frontends.
    expect(profile.isFirstYearStudent).toBe(false);
    expect(profile.meta).toEqual({
      postBookmarkIds: [],
      activityBookmarkIds: [],
      unreadNotifCount: 0,
    });
    for (const rawOnly of ['purgeLastError', 'scheduledPurgeAt', 'following']) {
      expect(profile).not.toHaveProperty(rawOnly);
    }
  });

  it('matches exactly what the next sync of the same account returns', async () => {
    const first = await build().syncProfile(VERIFIED_SIGNUP);

    clearAuthSyncCacheLocal();
    queryRaw = jest.fn().mockResolvedValue([{ ...CREATED_ROW }]);
    const later = await build().syncProfile(VERIFIED_SIGNUP);

    expect(first).toEqual(later);
  });
});

/**
 * Signup is no longer college-only, and sign-in no longer links a college.
 * See docs/college-affiliation.md.
 */
describe('AuthService — signup without a college', () => {
  let queryRaw: jest.Mock;
  let upsert: jest.Mock;
  let update: jest.Mock;
  let validateDomain: jest.Mock;

  const PERSONAL_ROW = {
    ...CREATED_ROW,
    email: 'ravi@gmail.com',
    collegeEmail: null,
    collegeId: null,
    college_id: null,
    college_name: null,
    gender: 'MALE',
  };

  const build = () =>
    new AuthService(
      stub<PrismaService>({
        $queryRaw: queryRaw,
        user: {
          findUnique: jest.fn().mockResolvedValue(null),
          upsert,
          update,
        },
      }),
      stub<SupabaseService>({ isConfigured: true, client: {} }),
      stub<DomainValidatorService>({ validateDomain }),
      stub<DefaultAssetsService>({ refFor: () => null }),
      createLegalConsentMock(),
    );

  beforeEach(() => {
    clearAuthSyncCacheLocal();
    upsert = jest.fn().mockResolvedValue({ id: USER_ID, username: 'ravi' });
    update = jest.fn().mockResolvedValue({});
    validateDomain = jest.fn().mockResolvedValue({
      isValid: false,
      reason: 'not a college',
    });
    queryRaw = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ ...PERSONAL_ROW }]);
  });

  afterEach(() => clearAuthSyncCacheLocal());

  /** The `create` branch of the one upsert the new-account path makes. */
  const createArg = (): Record<string, unknown> => {
    const calls = upsert.mock.calls as unknown as Array<
      [{ create: Record<string, unknown> }]
    >;
    return calls[0][0].create;
  };

  it('creates an account for a non-college address, storing gender and no college', async () => {
    const profile = await build().syncProfile({
      ...VERIFIED_SIGNUP,
      email: 'ravi@gmail.com',
      user_metadata: { ...VERIFIED_SIGNUP.user_metadata, gender: 'MALE' },
    });

    const create = createArg();
    expect(create).toMatchObject({ email: 'ravi@gmail.com', gender: 'MALE' });
    expect(create).not.toHaveProperty('collegeId');
    expect(create).not.toHaveProperty('collegeEmail');
    expect(profile.campusAffiliation).toBeNull();
    expect(profile.gender).toBe('MALE');
    expect(profile.profileCompletion).toEqual({
      needsPersonalEmail: false,
      needsGender: false,
      promptSnoozed: false,
    });
  });

  it('never grants a college from a college-domain signup address', async () => {
    validateDomain.mockResolvedValue({
      isValid: true,
      info: { collegeId: 'college-1', collegeName: 'Example College' },
    });
    await build().syncProfile(VERIFIED_SIGNUP);

    const create = createArg();
    expect(create).not.toHaveProperty('collegeId');
    // And the per-sign-in path does not link one either.
    const writes = update.mock.calls as unknown as Array<
      [{ data: Record<string, unknown> }]
    >;
    expect(writes.some(([arg]) => 'collegeId' in arg.data)).toBe(false);
  });

  it('ignores a gender value that is not one of the enum', async () => {
    await build().syncProfile({
      ...VERIFIED_SIGNUP,
      user_metadata: { ...VERIFIED_SIGNUP.user_metadata, gender: 'robot' },
    });
    const create = createArg();
    expect(create).not.toHaveProperty('gender');
  });

  it('reports the affiliation and asks a college-email login for a personal email', async () => {
    queryRaw = jest.fn().mockResolvedValue([
      {
        ...CREATED_ROW,
        gender: null,
        aff_college_id: 'college-1',
        aff_email: 'ravi@example.edu',
        aff_email_normalized: 'ravi@example.edu',
        aff_method: 'LEGACY_PRIMARY_EMAIL',
        aff_verified_at: new Date('2026-01-01T00:00:00Z'),
        aff_revoked_at: null,
        aff_college_name: 'Example College',
        aff_college_logo_key: null,
        aff_college_is_active: true,
        aff_college_status: 'APPROVED',
        aff_college_deleted_at: null,
      },
    ]);
    const profile = await build().syncProfile(VERIFIED_SIGNUP);
    expect(profile.campusAffiliation).toMatchObject({
      collegeId: 'college-1',
      collegeName: 'Example College',
      method: 'LEGACY_PRIMARY_EMAIL',
      active: true,
    });
    expect(profile.campusAffiliation?.email).toBe('ra***@example.edu');
    expect(profile.profileCompletion).toEqual({
      needsPersonalEmail: true,
      needsGender: true,
      promptSnoozed: false,
    });
  });
});

describe('AuthService.checkEmailAvailability — signup usage', () => {
  const build = (taken: boolean) =>
    new AuthService(
      stub<PrismaService>({
        user: {
          findUnique: jest
            .fn()
            .mockResolvedValue(taken ? { id: 'someone' } : null),
        },
      }),
      stub<SupabaseService>({}),
      stub<DomainValidatorService>({
        validateDomain: jest
          .fn()
          .mockResolvedValue({ isValid: false, reason: 'x' }),
      }),
      stub<DefaultAssetsService>({}),
      createLegalConsentMock(),
    );

  it('accepts any well-formed address that is not taken, with collegeId null', async () => {
    await expect(
      build(false).checkEmailAvailability('someone@gmail.com'),
    ).resolves.toEqual({ available: true, collegeId: null });
  });

  it('still reports a taken address and a malformed one with the old codes', async () => {
    await expect(
      build(true).checkEmailAvailability('someone@gmail.com'),
    ).resolves.toMatchObject({ available: false, code: 'email_taken' });
    await expect(
      build(false).checkEmailAvailability('nope'),
    ).resolves.toMatchObject({ available: false, code: 'invalid_email' });
  });
});
