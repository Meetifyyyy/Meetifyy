import { RealtimeGateway } from './realtime.gateway';
import { createVerificationAccessMock } from '../common/verification/testing/verification-access.mock';
import { createStudentYearPolicyMock } from '../common/student-year/testing/student-year-policy.mock';
import { createLegalConsentMock } from '../common/legal/testing/legal-consent.mock';
import { allowAllRateLimit } from '../common/rate-limit/testing/rate-limit.mock';

describe('RealtimeGateway — Authentication', () => {
  let gateway: RealtimeGateway;
  let supabaseService: any;
  let messagesService: any;
  let presenceService: any;
  let instantMatchService: any;
  let instantMatchLimiter: any;
  let prisma: any;
  let redisService: any;
  let activityPolicy: any;
  let communitiesService: any;
  let blocksService: any;
  let verificationAccess: any;
  let jwtGuard: any;

  beforeEach(() => {
    supabaseService = {
      isConfigured: true,
      client: {
        auth: {
          getUser: jest.fn(),
        },
      },
    };
    messagesService = {};
    presenceService = {
      setOnline: jest.fn(),
      setOffline: jest.fn(),
      registerSocketValidator: jest.fn(),
      onStatusChange: jest.fn(),
    };
    instantMatchService = {};
    instantMatchLimiter = {};
    prisma = {
      conversationParticipant: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      // The handshake reads the account's lifecycle state from the database
      // rather than the token, because the token predates any state change.
      user: {
        findUnique: jest.fn().mockResolvedValue({ accountStatus: 'ACTIVE' }),
      },
    };
    redisService = {
      getClient: jest.fn(),
      subscriber: jest.fn(),
    };
    activityPolicy = {};
    communitiesService = {};
    blocksService = {};
    verificationAccess = createVerificationAccessMock();
    jwtGuard = {
      validateToken: jest.fn(),
    };

    gateway = new RealtimeGateway(
      supabaseService,
      messagesService,
      presenceService,
      instantMatchService,
      instantMatchLimiter,
      prisma,
      redisService,
      activityPolicy,
      communitiesService,
      blocksService,
      verificationAccess,
      createStudentYearPolicyMock() as any,
      allowAllRateLimit(),
      // The socket applies the same mandatory-acknowledgement gate the REST
      // routes do. Defaults to satisfied, which is this suite's subject.
      createLegalConsentMock() as any,
      jwtGuard,
    );
  });

  it('rejects connection if token is missing', async () => {
    const client: any = {
      handshake: { auth: {} },
      disconnect: jest.fn(),
      join: jest.fn(),
    };

    await gateway.handleConnection(client);
    expect(client.disconnect).toHaveBeenCalled();
    expect(client.join).not.toHaveBeenCalled();
  });

  it('rejects connection if token verification fails (forged/invalid signature)', async () => {
    const client: any = {
      handshake: { auth: { token: 'header.forgedpayload.invalidsignature' } },
      disconnect: jest.fn(),
      join: jest.fn(),
    };

    jwtGuard.validateToken.mockResolvedValue(null);

    await gateway.handleConnection(client);
    expect(jwtGuard.validateToken).toHaveBeenCalledWith(
      'header.forgedpayload.invalidsignature',
    );
    expect(client.disconnect).toHaveBeenCalled();
    expect(client.join).not.toHaveBeenCalled();
  });

  // A valid token is not enough: an account inside its 30-day deletion window
  // keeps a working one on purpose, and sockets never pass through JwtGuard —
  // so without this check a deleting user keeps a live socket (online status,
  // presence, typing, new message delivery) while every HTTP route refuses them.
  it.each(['PENDING_DELETION', 'DELETED'])(
    'rejects connection when the account is %s despite a valid token',
    async (accountStatus) => {
      const client: any = {
        id: 'socket-999',
        handshake: { auth: { token: 'valid.signed.jwt' } },
        disconnect: jest.fn(),
        join: jest.fn(),
        emit: jest.fn(),
      };

      jwtGuard.validateToken.mockResolvedValue({
        id: 'deleting-user',
        email: 'gone@meetifyy.com',
        user_metadata: { username: 'gone' },
      });
      prisma.user.findUnique.mockResolvedValue({ accountStatus });

      await gateway.handleConnection(client);

      expect(client.disconnect).toHaveBeenCalled();
      expect(client.join).not.toHaveBeenCalled();
      expect(presenceService.setOnline).not.toHaveBeenCalled();
      // Distinguished from an auth failure so the client shows the recovery
      // gate rather than bouncing to sign-in.
      expect(client.emit).toHaveBeenCalledWith('account:unavailable', {
        code: 'ACCOUNT_PENDING_DELETION',
      });
    },
  );

  it('accepts connection if token verification succeeds with valid signature', async () => {
    const client: any = {
      id: 'socket-123',
      handshake: { auth: { token: 'valid.signed.jwt' } },
      disconnect: jest.fn(),
      join: jest.fn(),
    };

    jwtGuard.validateToken.mockResolvedValue({
      id: 'user-uuid-456',
      email: 'user@meetifyy.com',
      user_metadata: { displayName: 'Verified User', username: 'vuser' },
    });

    await gateway.handleConnection(client);
    expect(client.disconnect).not.toHaveBeenCalled();
    expect(client.userId).toBe('user-uuid-456');
    expect(client.userName).toBe('vuser');
    expect(client.join).toHaveBeenCalledWith('user-uuid-456');
    expect(presenceService.setOnline).toHaveBeenCalledWith(
      'user-uuid-456',
      'socket-123',
    );
  });

  it('rejects connection if Supabase auth is not configured', async () => {
    supabaseService.isConfigured = false;
    const client: any = {
      handshake: { auth: { token: 'some.token' } },
      disconnect: jest.fn(),
      join: jest.fn(),
    };

    await gateway.handleConnection(client);
    expect(client.disconnect).toHaveBeenCalled();
  });

  /**
   * The socket is not a read-only side channel: it delivers messages, presence
   * and typing. Refusing every HTTP route while leaving this connected would
   * let an account that has not accepted a mandatory policy update keep using
   * the parts of Meetifyy that matter most, with the modal sitting on screen.
   */
  it('rejects connection when a required legal update has not been accepted', async () => {
    const gatedGateway = new RealtimeGateway(
      supabaseService,
      messagesService,
      presenceService,
      instantMatchService,
      instantMatchLimiter,
      prisma,
      redisService,
      activityPolicy,
      communitiesService,
      blocksService,
      verificationAccess,
      createStudentYearPolicyMock() as any,
      allowAllRateLimit(),
      createLegalConsentMock({ satisfied: false }) as any,
      jwtGuard,
    );

    jwtGuard.validateToken.mockResolvedValue({
      id: 'unconsented-user',
      email: 'someone@example.edu',
    });

    const client: any = {
      id: 'socket-legal',
      handshake: { auth: { token: 'valid.token.signature' }, headers: {} },
      emit: jest.fn(),
      disconnect: jest.fn(),
      join: jest.fn(),
    };

    await gatedGateway.handleConnection(client);

    expect(client.disconnect).toHaveBeenCalled();
    // Told apart from an auth failure so the client shows the consent flow
    // rather than bouncing the user to the sign-in screen.
    expect(client.emit).toHaveBeenCalledWith('account:unavailable', {
      code: 'LEGAL_ACKNOWLEDGEMENT_REQUIRED',
    });
  });
});

/**
 * Realtime room joins are authorization decisions.
 *
 * `activity:join` always resolved one; `post:join` and `community:join_room`
 * took the id from the client and joined unconditionally. The post room carries
 * `comment.created`, which includes the comment body and its author, so any
 * authenticated socket could name any post id and read its comments live —
 * including posts whose REST route answers a neutral 404 because the author is
 * blocked or hidden by first-year isolation.
 */
describe('RealtimeGateway — room join authorization', () => {
  let gateway: RealtimeGateway;
  let prisma: any;
  let blocksService: any;
  let yearPolicy: any;

  const socket = () => ({ join: jest.fn(), leave: jest.fn(), emit: jest.fn(), userId: 'viewer' });

  beforeEach(() => {
    prisma = {
      post: { findFirst: jest.fn() },
      community: { findFirst: jest.fn() },
      communityMember: { findFirst: jest.fn().mockResolvedValue(null) },
      user: { findUnique: jest.fn() },
      conversationParticipant: { findMany: jest.fn().mockResolvedValue([]) },
    };
    blocksService = { getExcludedUserIds: jest.fn().mockResolvedValue([]) };
    yearPolicy = createStudentYearPolicyMock() as any;
    yearPolicy.canIdsInteract = jest.fn().mockResolvedValue(true);

    gateway = new RealtimeGateway(
      { isConfigured: true, client: { auth: { getUser: jest.fn() } } } as any,
      {} as any,
      { registerSocketValidator: jest.fn(), onStatusChange: jest.fn() } as any,
      {} as any, {} as any,
      prisma,
      { getClient: jest.fn(), subscriber: jest.fn() } as any,
      {} as any,
      { countOnlineMembers: jest.fn().mockResolvedValue(0) } as any,
      blocksService,
      createVerificationAccessMock() as any,
      yearPolicy,
      allowAllRateLimit(),
      createLegalConsentMock() as any,
      { validateToken: jest.fn() } as any,
    );
  });

  describe('post:join', () => {
    it('joins a post the viewer may see', async () => {
      prisma.post.findFirst.mockResolvedValue({ authorId: 'author', community: null });
      const client = socket();
      await gateway.handlePostJoin(client as any, { postId: 'p1' });
      expect(client.join).toHaveBeenCalledWith('post_p1');
    });

    it('refuses a post whose author blocks the viewer', async () => {
      prisma.post.findFirst.mockResolvedValue({ authorId: 'author', community: null });
      blocksService.getExcludedUserIds.mockResolvedValue(['author']);
      const client = socket();
      await gateway.handlePostJoin(client as any, { postId: 'p1' });
      expect(client.join).not.toHaveBeenCalled();
    });

    it('refuses a post hidden by first-year isolation', async () => {
      prisma.post.findFirst.mockResolvedValue({ authorId: 'author', community: null });
      yearPolicy.canIdsInteract.mockResolvedValue(false);
      const client = socket();
      await gateway.handlePostJoin(client as any, { postId: 'p1' });
      expect(client.join).not.toHaveBeenCalled();
    });

    it('refuses a deleted post, and a post in a deleted community', async () => {
      const client = socket();
      prisma.post.findFirst.mockResolvedValue(null);
      await gateway.handlePostJoin(client as any, { postId: 'gone' });
      expect(client.join).not.toHaveBeenCalled();

      prisma.post.findFirst.mockResolvedValue({
        authorId: 'author', community: { deletedAt: new Date() },
      });
      await gateway.handlePostJoin(client as any, { postId: 'p2' });
      expect(client.join).not.toHaveBeenCalled();
    });

    it('fails closed when the policy lookup throws', async () => {
      prisma.post.findFirst.mockRejectedValue(new Error('db down'));
      const client = socket();
      await gateway.handlePostJoin(client as any, { postId: 'p1' });
      expect(client.join).not.toHaveBeenCalled();
    });
  });

  describe('community:join_room', () => {
    it('joins a public community', async () => {
      prisma.community.findFirst.mockResolvedValue({ id: 'c1', isPrivate: false, ownerId: 'someone' });
      const client = socket();
      await gateway.handleJoinCommunityRoom(client as any, { communityId: 'c1' });
      expect(client.join).toHaveBeenCalledWith('community_c1');
    });

    it('refuses a private community the viewer is not in', async () => {
      prisma.community.findFirst.mockResolvedValue({ id: 'c1', isPrivate: true, ownerId: 'someone' });
      prisma.communityMember.findFirst.mockResolvedValue(null);
      const client = socket();
      await gateway.handleJoinCommunityRoom(client as any, { communityId: 'c1' });
      expect(client.join).not.toHaveBeenCalled();
    });

    it('joins a private community the viewer belongs to', async () => {
      prisma.community.findFirst.mockResolvedValue({ id: 'c1', isPrivate: true, ownerId: 'someone' });
      prisma.communityMember.findFirst.mockResolvedValue({ userId: 'viewer' });
      const client = socket();
      await gateway.handleJoinCommunityRoom(client as any, { communityId: 'c1' });
      expect(client.join).toHaveBeenCalledWith('community_c1');
    });

    it('refuses a deleted community', async () => {
      prisma.community.findFirst.mockResolvedValue(null);
      const client = socket();
      await gateway.handleJoinCommunityRoom(client as any, { communityId: 'gone' });
      expect(client.join).not.toHaveBeenCalled();
    });
  });
});
