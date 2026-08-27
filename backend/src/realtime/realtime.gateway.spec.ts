import { RealtimeGateway } from './realtime.gateway';

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
  let socketMetrics: any;
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
    };
    redisService = {
      getClient: jest.fn(),
      subscriber: jest.fn(),
    };
    activityPolicy = {};
    communitiesService = {};
    blocksService = {};
    socketMetrics = {
      registerServer: jest.fn(),
    };
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
      socketMetrics,
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
