import { AuthService, clearAuthSyncCacheLocal } from './auth.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { SupabaseService } from '../supabase/supabase.service';
import type { DomainValidatorService } from '../common/services/domain-validator.service';
import type { DefaultAssetsService } from '../uploads/default-assets.service';
import { createStudentYearPolicyMock } from '../common/student-year/testing/student-year-policy.mock';
import { createLegalConsentMock } from '../common/legal/testing/legal-consent.mock';
import { stub } from '../common/testing/stub';

/**
 * The first sync of a brand-new account.
 *
 * It used to answer with the Prisma row it had just written: every column,
 * purge bookkeeping included, and none of `meta` or `isFirstYearStudent`. A
 * new first-year student was therefore drawn as unrestricted until the next
 * sync. It now reads the row back through the same query and builder every
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
      createStudentYearPolicyMock(),
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

    expect(profile).toHaveProperty('isFirstYearStudent');
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
