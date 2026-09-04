import { RealtimeGateway } from './realtime.gateway';
import { createVerificationAccessMock } from '../common/verification/testing/verification-access.mock';
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
      allowAllRateLimit(),
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
});
