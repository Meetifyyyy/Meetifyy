import { AuthService, clearAuthSyncCacheLocal } from './auth.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { SupabaseService } from '../supabase/supabase.service';
import type { DomainValidatorService } from '../common/services/domain-validator.service';
import type { DefaultAssetsService } from '../uploads/default-assets.service';
import { createLegalConsentMock } from '../common/legal/testing/legal-consent.mock';
import { stub } from '../common/testing/stub';

/**
 * `profileCompletion.promptSnoozed` depends on WHICH session asks, while the
 * profile itself is cached per user for 60s and shared by every session.
 */
const USER_ID = 'user-1';

const ROW = {
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
  collegeEmail: null,
  collegeId: null,
  cover: null,
  coverMediaId: null,
  verificationStatus: 'UNVERIFIED',
  birthday: null,
  interests: [],
  profileCompleted: true,
  accountStatus: 'ACTIVE',
  deletedAt: null,
  role: 'Student',
  canPost: true,
  canMessage: true,
  canActivity: true,
  isCampusRep: false,
  gender: null,
  profilePromptLaterAt: null as Date | null,
  profilePromptLaterSessionId: null as string | null,
  college_id: null,
  college_name: null,
  settings_id: null,
  followingList: [],
  followersList: [],
  postBookmarkIds: [],
  activityBookmarkIds: [],
  unreadNotifCount: 0,
};

describe('AuthService.syncProfile: promptSnoozed', () => {
  const queryRaw = jest.fn();

  const build = () =>
    new AuthService(
      stub<PrismaService>({ $queryRaw: queryRaw, user: {} }),
      stub<SupabaseService>({ isConfigured: true, client: {} }),
      stub<DomainValidatorService>({}),
      stub<DefaultAssetsService>({ refFor: () => null }),
      createLegalConsentMock(),
    );

  const identity = { id: USER_ID, email: ROW.email };

  beforeEach(() => {
    clearAuthSyncCacheLocal();
    queryRaw.mockReset();
  });
  afterEach(() => clearAuthSyncCacheLocal());

  it('is snoozed for the session that pressed Later, not for another one, from the same cached profile', async () => {
    queryRaw.mockResolvedValue([
      {
        ...ROW,
        profilePromptLaterAt: new Date(Date.now() - 60_000),
        profilePromptLaterSessionId: 'sess-a',
      },
    ]);
    const service = build();

    const same = await service.syncProfile(identity, 'sess-a');
    const other = await service.syncProfile(identity, 'sess-b'); // cache hit
    const unknown = await service.syncProfile(identity);

    expect(same.profileCompletion.promptSnoozed).toBe(true);
    expect(other.profileCompletion.promptSnoozed).toBe(false);
    expect(unknown.profileCompletion.promptSnoozed).toBe(false);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('is not snoozed once 10 days have passed', async () => {
    queryRaw.mockResolvedValue([
      {
        ...ROW,
        profilePromptLaterAt: new Date(Date.now() - 11 * 24 * 60 * 60 * 1000),
        profilePromptLaterSessionId: 'sess-a',
      },
    ]);

    const profile = await build().syncProfile(identity, 'sess-a');

    expect(profile.profileCompletion.promptSnoozed).toBe(false);
  });

  it('never exposes the stored session id in the payload', async () => {
    queryRaw.mockResolvedValue([
      {
        ...ROW,
        profilePromptLaterAt: new Date(),
        profilePromptLaterSessionId: 'sess-a',
      },
    ]);

    const profile = await build().syncProfile(identity, 'sess-a');

    expect(JSON.stringify(profile)).not.toContain('sess-a');
    expect(profile.profileCompletion).toEqual({
      needsPersonalEmail: false,
      needsGender: true,
      promptSnoozed: true,
    });
  });
});
