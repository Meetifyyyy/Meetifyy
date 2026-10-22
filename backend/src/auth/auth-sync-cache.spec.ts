import { Test, TestingModule } from '@nestjs/testing';
import { AuthService, type SyncIdentity } from './auth.service';
import {
  AUTH_SYNC_INVALIDATE_CHANNEL,
  clearAuthSyncCache,
  clearAuthSyncCacheLocal,
} from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService } from '../supabase/supabase.service';
import { DefaultAssetsService } from '../uploads/default-assets.service';
import { DomainValidatorService } from '../common/services/domain-validator.service';
import { RedisService } from '../redis/redis.service';
import { legalConsentMockProvider } from '../common/legal/testing/legal-consent.mock';

/**
 * The auth bootstrap cache, and its cross-instance invalidation.
 *
 * `/api/auth/sync` serves the whole profile — `followingList` included — from a
 * 60-second in-process LRU, and the client replaces `currentUser.followingList`
 * with whatever it answers. So a stale entry does not merely delay a count: it
 * reverts follows the viewer has already performed.
 *
 * Clearing the entry locally is only correct on a single instance. With
 * replicas, a follow handled by A left B and C answering from before the write
 * for the rest of the TTL, and whether the UI reverted came down to which
 * replica the next sync happened to reach. These tests cover the local cache
 * behaviour and the pub/sub that extends it across the fleet.
 */

const USER_ID = 'user-1';

/** A well-formed bootstrap row: no auto-heal, no college auto-link. */
const PROFILE_ROW = {
  id: USER_ID,
  username: 'ravi',
  displayName: 'Ravi',
  email: 'ravi@example.edu',
  bio: null,
  course: null,
  branch: null,
  passingYear: null,
  location: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  avatar: null,
  avatarMediaId: null,
  collegeEmail: 'ravi@example.edu',
  collegeId: 'college-1',
  cover: null,
  coverMediaId: null,
  verificationStatus: 'VERIFIED',
  birthday: new Date('2000-01-01'),
  interests: [],
  profileCompleted: true,
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
  followingList: ['ann'],
  followersList: [],
  postBookmarkIds: [],
  activityBookmarkIds: [],
  unreadNotifCount: 0,
};

const AUTH_USER: SyncIdentity = { id: USER_ID, email: 'ravi@example.edu' };

describe('Auth sync cache', () => {
  let service: AuthService;
  let queryRaw: jest.Mock;
  let publish: jest.Mock;
  let subscribe: jest.Mock;
  /** Channel handlers registered through subClient.on('message', …). */
  let messageHandlers: ((channel: string, message: string) => void)[];
  /**
   * The pub/sub wiring belongs to the module-level cache and is installed
   * once per process, so each test has to tear its module down or the next
   * one inherits a subscription it did not register.
   */
  let activeModule: TestingModule | null = null;

  const build = async ({ withRedis = true } = {}) => {
    queryRaw = jest.fn().mockResolvedValue([{ ...PROFILE_ROW }]);
    publish = jest.fn().mockResolvedValue(1);
    subscribe = jest.fn();
    messageHandlers = [];

    const subClient = {
      subscribe,
      on: jest.fn(
        (
          event: string,
          handler: (channel: string, message: string) => void,
        ) => {
          if (event === 'message') messageHandlers.push(handler);
        },
      ),
    };

    const redisService = {
      getClient: () => ({}),
      getPubClient: () => ({ publish }),
      getSubClient: () => subClient,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        // Account creation records what the new user agreed to at signup. This
        // suite is about the sync cache, so the double records nothing.
        legalConsentMockProvider(),
        AuthService,
        { provide: PrismaService, useValue: { $queryRaw: queryRaw, user: {} } },
        {
          provide: SupabaseService,
          useValue: { isConfigured: true, client: {} },
        },
        { provide: DefaultAssetsService, useValue: { refFor: () => null } },
        {
          provide: DomainValidatorService,
          useValue: {
            validateDomain: jest.fn().mockResolvedValue({
              isValid: true,
              info: { collegeId: 'college-1' },
            }),
          },
        },
        {
          provide: RedisService,
          useValue: withRedis ? redisService : undefined,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    activeModule = module;
    return module;
  };

  /** Deliver a message as another replica's broadcast would arrive. */
  const deliver = (
    payload: unknown,
    channel = AUTH_SYNC_INVALIDATE_CHANNEL,
  ) => {
    for (const handler of messageHandlers) {
      handler(channel, JSON.stringify(payload));
    }
  };

  beforeEach(() => {
    // The cache is module-level and outlives any one service instance.
    clearAuthSyncCacheLocal();
  });

  afterEach(async () => {
    if (activeModule) {
      await activeModule.close();
      activeModule = null;
    }
    clearAuthSyncCacheLocal();
  });

  describe('local behaviour', () => {
    it('serves a second sync from cache instead of hitting the database', async () => {
      const module = await build();
      await module.init();

      const first = await service.syncProfile(AUTH_USER);
      const second = await service.syncProfile(AUTH_USER);

      expect(queryRaw).toHaveBeenCalledTimes(1);
      expect(second).toBe(first);
      expect(first.followingList).toEqual(['ann']);
    });

    it('re-reads the database after the entry is invalidated', async () => {
      const module = await build();
      await module.init();

      await service.syncProfile(AUTH_USER);
      // What followUser does the moment a Follow row is written.
      clearAuthSyncCache(USER_ID);
      queryRaw.mockResolvedValue([
        { ...PROFILE_ROW, followingList: ['ann', 'bob'] },
      ]);

      const after = await service.syncProfile(AUTH_USER);

      expect(queryRaw).toHaveBeenCalledTimes(2);
      // The newly-followed account is present — this is the value the client
      // writes over currentUser.followingList.
      expect(after.followingList).toEqual(['ann', 'bob']);
    });
  });

  describe('bookmark ids', () => {
    /**
     * The client treats `meta.postBookmarkIds` / `meta.activityBookmarkIds` as
     * the complete set: an id missing from it renders as "not saved". A
     * `take: 200` copy of these reads once sat in AuthService (unused, but one
     * call away from being wired in), and would have shown every bookmark
     * past the 200th as un-bookmarked.
     */
    it('returns every bookmark id, not the newest N', async () => {
      const module = await build();
      await module.init();
      const posts = Array.from({ length: 1200 }, (_, i) => `p${i}`);
      const activities = Array.from({ length: 450 }, (_, i) => `a${i}`);
      queryRaw.mockResolvedValue([
        {
          ...PROFILE_ROW,
          postBookmarkIds: posts,
          activityBookmarkIds: activities,
        },
      ]);

      const profile = await service.syncProfile(AUTH_USER);

      expect(profile.meta.postBookmarkIds).toEqual(posts);
      expect(profile.meta.activityBookmarkIds).toEqual(activities);
    });

    it('reads the bookmark sets without a row limit', async () => {
      const module = await build();
      await module.init();

      await service.syncProfile(AUTH_USER);

      const calls = queryRaw.mock.calls as unknown[][];
      const strings = calls[0][0] as readonly string[];
      const sql = strings.join('?');
      for (const table of ['"PostBookmark"', '"ActivityBookmark"']) {
        const at = sql.indexOf(table);
        expect(at).toBeGreaterThan(-1);
        // The subselect for this set runs to the closing COALESCE default.
        const subselect = sql.slice(at, sql.indexOf("'[]'::json", at));
        expect(subselect).not.toMatch(/\bLIMIT\b/i);
      }
    });
  });

  describe('cross-instance invalidation', () => {
    it('subscribes to the invalidation channel on init', async () => {
      const module = await build();
      await module.init();

      expect(subscribe).toHaveBeenCalledWith(
        AUTH_SYNC_INVALIDATE_CHANNEL,
        expect.any(Function),
      );
    });

    it('broadcasts when a user is invalidated, so other replicas drop their copy', async () => {
      const module = await build();
      await module.init();

      clearAuthSyncCache(USER_ID);

      expect(publish).toHaveBeenCalledWith(
        AUTH_SYNC_INVALIDATE_CHANNEL,
        JSON.stringify({ userId: USER_ID }),
      );
    });

    it('drops the local entry when another replica broadcasts', async () => {
      const module = await build();
      await module.init();

      await service.syncProfile(AUTH_USER);
      expect(queryRaw).toHaveBeenCalledTimes(1);

      // A follow handled by a different replica.
      deliver({ userId: USER_ID });
      queryRaw.mockResolvedValue([
        { ...PROFILE_ROW, followingList: ['ann', 'bob'] },
      ]);

      const after = await service.syncProfile(AUTH_USER);

      // Without the subscription this stays at 1 and the stale followingList
      // is served for the rest of the TTL.
      expect(queryRaw).toHaveBeenCalledTimes(2);
      expect(after.followingList).toEqual(['ann', 'bob']);
    });

    it('does not echo a received invalidation back onto the channel', async () => {
      const module = await build();
      await module.init();
      publish.mockClear();

      deliver({ userId: USER_ID });

      // Republishing here would have every replica answering every other
      // replica's message, forever.
      expect(publish).not.toHaveBeenCalled();
    });

    it('honours a fleet-wide clear', async () => {
      const module = await build();
      await module.init();

      await service.syncProfile(AUTH_USER);
      deliver({ userId: null });
      await service.syncProfile(AUTH_USER);

      expect(queryRaw).toHaveBeenCalledTimes(2);
    });

    it('ignores traffic on other channels and malformed payloads', async () => {
      const module = await build();
      await module.init();

      await service.syncProfile(AUTH_USER);

      for (const handler of messageHandlers) {
        handler('meetifyy:something_else', JSON.stringify({ userId: USER_ID }));
        handler(AUTH_SYNC_INVALIDATE_CHANNEL, 'not json');
      }
      await service.syncProfile(AUTH_USER);

      expect(queryRaw).toHaveBeenCalledTimes(1);
    });

    it('stops publishing once the module is torn down', async () => {
      const module = await build();
      await module.init();
      await module.close();
      activeModule = null;
      publish.mockClear();

      clearAuthSyncCache(USER_ID);

      // The Redis client is closed by then; publishing through it would throw
      // on a connection nobody owns any more.
      expect(publish).not.toHaveBeenCalled();
    });
  });

  describe('without Redis', () => {
    it('still invalidates locally, and does not throw', async () => {
      const module = await build({ withRedis: false });
      await module.init();

      await service.syncProfile(AUTH_USER);
      expect(() => clearAuthSyncCache(USER_ID)).not.toThrow();
      queryRaw.mockResolvedValue([
        { ...PROFILE_ROW, followingList: ['ann', 'bob'] },
      ]);
      const after = await service.syncProfile(AUTH_USER);

      // Single-instance correctness is unchanged; the TTL is the only bound
      // that was ever available here.
      expect(queryRaw).toHaveBeenCalledTimes(2);
      expect(after.followingList).toEqual(['ann', 'bob']);
    });
  });
});
