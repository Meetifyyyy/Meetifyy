import type { Server } from 'http';
import { Logger, type INestApplication, type Type } from '@nestjs/common';
import request from 'supertest';
import { createPaginationApp } from '../common/testing/pagination-app';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { GroupChatsController } from './group-chats/group-chats.controller';
import { GroupChatsService } from './group-chats/group-chats.service';
import { DmController } from './dm/dm.controller';
import { DmService } from './dm/dm.service';
import { BlocksService } from '../users/blocks.service';
import { DomainEventService } from '../events/domain-event.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationFactory } from '../notifications/notification.factory';
import { VerificationAccessService } from '../common/verification/verification-access.service';
import { JwtGuard } from '../common/guards/jwt.guard';
import {
  MAX_FORWARD_TARGETS,
  MAX_GROUP_AVATAR_LENGTH,
  MAX_GROUP_DESCRIPTION_LENGTH,
  MAX_GROUP_NAME_LENGTH,
  MAX_GROUP_PERMISSION_LENGTH,
  MAX_NEW_GROUP_MEMBERS,
  MAX_REACTION_LENGTH,
} from './core/message-limits';

const uuid = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const uuids = (count: number): string[] =>
  Array.from({ length: count }, (_, i) => uuid(i + 1));
const ids = (count: number): string[] =>
  Array.from({ length: count }, (_, i) => `conv-${i + 1}`);

type Spy = jest.Mock<Promise<unknown>, unknown[]>;
const spy = (result: unknown = {}): Spy =>
  jest.fn((..._args: unknown[]) => Promise.resolve(result));

/**
 * Every body field on these three controllers used to be a named `@Body('x')`,
 * which the global ValidationPipe does not look at: no type, no array cap, no
 * length. They now run through DTOs, and these tests go through the real pipe
 * (same options as `main.ts`) to show what is refused and what still passes.
 */
describe('messaging controllers: body validation', () => {
  beforeAll(() => {
    // Handlers fan out after answering and some of these stubs are thin; the
    // failures of that background work are not what is under test.
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterAll(() => jest.restoreAllMocks());

  /** The service methods both conversation services expose to these routes. */
  const conversationService = () => ({
    forwardMessage: spy({ messages: [] }),
    reactToMessage: spy({ success: true }),
    muteConversation: spy({ success: true }),
    pinConversation: spy({ success: true }),
    startConversation: spy({ id: 'conv-1', publicId: 'conv-1' }),
    createGroup: spy({ id: 'g1', publicId: 'g1' }),
    updateGroupInfo: spy({
      updated: {},
      convBefore: {},
      actorHandle: '@a',
      participantIds: [],
    }),
    addGroupMember: spy({ alreadyMember: true }),
    updateGroupEditPermission: spy({ success: true }),
    changeGroupOwner: spy({ success: true }),
    promoteToAdmin: spy({ success: true }),
    resolveConversationId: spy('conv-1'),
    getConversationById: spy({}),
    getConversationParticipantIds: spy([]),
    getUserHandle: spy('@someone'),
    invalidateGroupDetailsCache: spy(),
    createSystemMessage: spy(null),
  });
  type ConversationService = ReturnType<typeof conversationService>;

  const domainEvents = { emit: jest.fn() };

  /** Routes the messages and group-chats controllers share, under `base`. */
  function describeConversationRoutes(
    label: string,
    base: string,
    start: () => Promise<{
      app: INestApplication<Server>;
      service: ConversationService;
    }>,
    infoPath: (id: string) => string,
  ) {
    describe(label, () => {
      let app: INestApplication<Server>;
      let service: ConversationService;
      const http = () => request(app.getHttpServer());

      beforeAll(async () => {
        ({ app, service } = await start());
      });
      afterAll(async () => {
        await app.close();
      });
      beforeEach(() => jest.clearAllMocks());

      describe('forward', () => {
        const forward = (body: unknown) =>
          http()
            .post(`${base}/msg/m1/forward`)
            .send(body as object);

        it('passes the targets the client sends', async () => {
          await forward({ targetConversationIds: ['c1', 'c2'] }).expect(201);
          expect(service.forwardMessage).toHaveBeenCalledWith(
            'm1',
            ['c1', 'c2'],
            'user-1',
          );
        });

        it('accepts the cap and refuses one more, in the same words the service uses', async () => {
          await forward({
            targetConversationIds: ids(MAX_FORWARD_TARGETS),
          }).expect(201);
          const res = await forward({
            targetConversationIds: ids(MAX_FORWARD_TARGETS + 1),
          }).expect(400);
          expect(JSON.stringify(res.body)).toContain(
            `at most ${MAX_FORWARD_TARGETS} chats`,
          );
          expect(service.forwardMessage).toHaveBeenCalledTimes(1);
        });

        it('keeps the old message for an empty or missing list', async () => {
          const empty = await forward({ targetConversationIds: [] }).expect(
            400,
          );
          const missing = await forward({}).expect(400);
          expect(JSON.stringify(empty.body)).toContain(
            'targetConversationIds array is required',
          );
          expect(JSON.stringify(missing.body)).toContain(
            'targetConversationIds array is required',
          );
        });

        it.each([
          ['a string', { targetConversationIds: 'c1' }],
          ['numbers', { targetConversationIds: [1] }],
          ['empty entries', { targetConversationIds: [''] }],
          ['an over-long id', { targetConversationIds: ['x'.repeat(129)] }],
          ['nested arrays', { targetConversationIds: [['c1']] }],
          ['an undeclared field', { targetConversationIds: ['c1'], a: 1 }],
        ])('refuses %s', async (_l, body) => {
          await forward(body).expect(400);
          expect(service.forwardMessage).not.toHaveBeenCalled();
        });
      });

      describe('react', () => {
        const react = (body: unknown) =>
          http()
            .post(`${base}/m1/react`)
            .send(body as object);

        it.each(['👍', '❤️', '👨‍👩‍👧‍👦'])('accepts %s', async (reaction) => {
          await react({ reaction }).expect(201);
          expect(service.reactToMessage).toHaveBeenCalledWith(
            'm1',
            'user-1',
            reaction,
          );
        });

        it.each([
          [
            'an over-long reaction',
            { reaction: 'x'.repeat(MAX_REACTION_LENGTH + 1) },
          ],
          ['an empty reaction', { reaction: '' }],
          ['a number', { reaction: 1 }],
          ['an array', { reaction: ['👍'] }],
          ['a missing field', {}],
          ['an undeclared field', { reaction: '👍', a: 1 }],
        ])('refuses %s', async (_l, body) => {
          await react(body).expect(400);
          expect(service.reactToMessage).not.toHaveBeenCalled();
        });
      });

      describe('mute and pin', () => {
        it('writes the booleans the client sends', async () => {
          await http()
            .patch(`${base}/c1/mute`)
            .send({ muted: true })
            .expect(200);
          await http()
            .patch(`${base}/c1/pin`)
            .send({ pinned: false })
            .expect(200);
          expect(service.muteConversation).toHaveBeenCalledWith(
            'c1',
            'user-1',
            true,
          );
          expect(service.pinConversation).toHaveBeenCalledWith(
            'c1',
            'user-1',
            false,
          );
        });

        it.each([
          ['mute', { muted: 'true' }],
          ['mute', { muted: 1 }],
          ['mute', {}],
          ['pin', { pinned: 'false' }],
          ['pin', { pinned: null }],
          ['pin', { pinned: true, a: 1 }],
        ])('refuses a bad %s body %j', async (route, body) => {
          await http().patch(`${base}/c1/${route}`).send(body).expect(400);
          expect(service.muteConversation).not.toHaveBeenCalled();
          expect(service.pinConversation).not.toHaveBeenCalled();
        });
      });

      describe('group members and roles', () => {
        it('passes a UUID member id through', async () => {
          await http()
            .post(`${base}/c1/members`)
            .send({ userId: uuid(7) });
          expect(service.addGroupMember).toHaveBeenCalledWith(
            'c1',
            'user-1',
            uuid(7),
          );
        });

        it.each([['owner'], ['admins']])(
          'passes a UUID target id to %s',
          async (route) => {
            await http()
              .post(`${base}/c1/${route}`)
              .send({ targetUserId: uuid(7) });
            const spied =
              route === 'owner'
                ? service.changeGroupOwner
                : service.promoteToAdmin;
            expect(spied).toHaveBeenCalledWith('c1', 'user-1', uuid(7));
          },
        );

        it.each([
          ['members', { userId: 'someone' }],
          ['members', { userId: [uuid(1)] }],
          ['members', {}],
          ['members', { userId: uuid(1), a: 1 }],
          ['owner', { targetUserId: 5 }],
          ['owner', { targetUserId: 'someone' }],
          ['admins', { targetUserId: { id: uuid(1) } }],
          ['admins', {}],
        ])('refuses %s with %j', async (route, body) => {
          await http().post(`${base}/c1/${route}`).send(body).expect(400);
          expect(service.addGroupMember).not.toHaveBeenCalled();
          expect(service.changeGroupOwner).not.toHaveBeenCalled();
          expect(service.promoteToAdmin).not.toHaveBeenCalled();
        });
      });

      describe('edit permission', () => {
        const put = (body: unknown) =>
          http()
            .patch(`${base}/c1/permissions`)
            .send(body as object);

        it('passes the value through, whatever spelling an old app used', async () => {
          await put({ permission: 'EVERYONE' }).expect(200);
          await put({ permission: 'Only admins' }).expect(200);
          expect(service.updateGroupEditPermission).toHaveBeenCalledTimes(2);
        });

        it.each([
          ['empty', { permission: '' }],
          [
            'too long',
            { permission: 'x'.repeat(MAX_GROUP_PERMISSION_LENGTH + 1) },
          ],
          ['a number', { permission: 1 }],
          ['missing', {}],
        ])('refuses %s', async (_l, body) => {
          await put(body).expect(400);
          expect(service.updateGroupEditPermission).not.toHaveBeenCalled();
        });
      });

      describe('group info', () => {
        const patch = (body: unknown) =>
          http()
            .patch(infoPath('c1'))
            .send(body as object);

        it.each([
          [
            'name, description and avatarKey',
            { name: 'Study', description: 'd', avatarKey: 'k' },
          ],
          [
            'the older `avatar` spelling',
            { avatar: 'https://cdn.test/a.webp' },
          ],
          ['only a name', { name: 'Study' }],
          [
            'limits exactly',
            {
              name: 'n'.repeat(MAX_GROUP_NAME_LENGTH),
              description: 'd'.repeat(MAX_GROUP_DESCRIPTION_LENGTH),
              avatarKey: 'k'.repeat(MAX_GROUP_AVATAR_LENGTH),
            },
          ],
        ])('accepts %s', async (_l, body) => {
          const res = await patch(body);
          expect(res.status).not.toBe(400);
          expect(service.updateGroupInfo).toHaveBeenCalledWith(
            'c1',
            'user-1',
            expect.objectContaining(body),
          );
        });

        it.each([
          [
            'a name over the limit',
            { name: 'n'.repeat(MAX_GROUP_NAME_LENGTH + 1) },
          ],
          [
            'a description over the limit',
            { description: 'd'.repeat(MAX_GROUP_DESCRIPTION_LENGTH + 1) },
          ],
          [
            'an avatar over the limit',
            { avatarKey: 'k'.repeat(MAX_GROUP_AVATAR_LENGTH + 1) },
          ],
          ['a numeric name', { name: 5 }],
          ['an array name', { name: ['a'] }],
          ['an object avatar', { avatarKey: { url: 'x' } }],
          ['an undeclared field', { name: 'ok', ownerId: uuid(1) }],
        ])('refuses %s', async (_l, body) => {
          await patch(body).expect(400);
          expect(service.updateGroupInfo).not.toHaveBeenCalled();
        });
      });
    });
  }

  const commonProviders = [
    { provide: DomainEventService, useValue: domainEvents },
    { provide: NotificationsService, useValue: {} },
    { provide: NotificationFactory, useValue: {} },
  ];

  async function startController(
    controller: Type<unknown>,
    serviceToken: Type<unknown>,
  ) {
    const service = conversationService();
    const app = await createPaginationApp({
      controller,
      guards: [JwtGuard],
      validate: true,
      providers: [
        { provide: serviceToken, useValue: service },
        ...commonProviders,
      ],
    });
    return { app, service };
  }

  describeConversationRoutes(
    '/api/messages',
    '/api/messages',
    () => startController(MessagesController, MessagesService),
    (id) => `/api/messages/${id}/group`,
  );

  describeConversationRoutes(
    '/api/group-chats',
    '/api/group-chats',
    () => startController(GroupChatsController, GroupChatsService),
    (id) => `/api/group-chats/${id}/info`,
  );

  describe('POST /api/group-chats (create)', () => {
    let app: INestApplication<Server>;
    let service: ConversationService;
    const create = (body: unknown) =>
      request(app.getHttpServer())
        .post('/api/group-chats')
        .send(body as object);

    beforeAll(async () => {
      ({ app, service } = await startController(
        GroupChatsController,
        GroupChatsService,
      ));
    });
    afterAll(async () => {
      await app.close();
    });
    beforeEach(() => jest.clearAllMocks());

    it('creates a group from the body the web and native apps send', async () => {
      await create({ name: 'Study', userIds: [uuid(1), uuid(2)] }).expect(201);
      expect(service.createGroup).toHaveBeenCalledWith(
        [uuid(1), uuid(2)],
        'user-1',
        'Study',
      );
    });

    it('still reads a missing userIds as just the creator', async () => {
      await create({ name: 'Solo' }).expect(201);
      expect(service.createGroup).toHaveBeenCalledWith([], 'user-1', 'Solo');
    });

    it('accepts the cap and refuses one more', async () => {
      await create({
        name: 'Big',
        userIds: uuids(MAX_NEW_GROUP_MEMBERS),
      }).expect(201);
      await create({
        name: 'Bigger',
        userIds: uuids(MAX_NEW_GROUP_MEMBERS + 1),
      }).expect(400);
      expect(service.createGroup).toHaveBeenCalledTimes(1);
    });

    it('refuses an array of the size a 100 KB body allows', async () => {
      await create({ name: 'Huge', userIds: uuids(2500) }).expect(400);
      expect(service.createGroup).not.toHaveBeenCalled();
    });

    it('keeps its message for a missing name', async () => {
      const res = await create({ userIds: [uuid(1)] }).expect(400);
      expect(JSON.stringify(res.body)).toContain('Group name is required');
      const blank = await create({ name: '', userIds: [uuid(1)] }).expect(400);
      expect(JSON.stringify(blank.body)).toContain('Group name is required');
    });

    it('accepts a name of exactly the limit, counting an emoji once', async () => {
      await create({ name: '😀'.repeat(MAX_GROUP_NAME_LENGTH) }).expect(201);
      await create({ name: 'n'.repeat(MAX_GROUP_NAME_LENGTH + 1) }).expect(400);
    });

    it.each([
      ['a numeric name', { name: 5, userIds: [] }],
      ['an array name', { name: ['a'], userIds: [] }],
      ['userIds as a string', { name: 'g', userIds: uuid(1) }],
      ['userIds as an object', { name: 'g', userIds: { id: uuid(1) } }],
      ['ids that are not UUIDs', { name: 'g', userIds: ['x'] }],
      ['numeric ids', { name: 'g', userIds: [1] }],
      ['object ids', { name: 'g', userIds: [{ id: uuid(1) }] }],
      ['an undeclared field', { name: 'g', userIds: [], ownerId: uuid(1) }],
    ])('refuses %s', async (_l, body) => {
      await create(body).expect(400);
      expect(service.createGroup).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/messages (start a conversation)', () => {
    let app: INestApplication<Server>;
    let service: ConversationService;
    const start = (body: unknown, query = '') =>
      request(app.getHttpServer())
        .post(`/api/messages${query}`)
        .send(body as object);

    beforeAll(async () => {
      ({ app, service } = await startController(
        MessagesController,
        MessagesService,
      ));
    });
    afterAll(async () => {
      await app.close();
    });
    beforeEach(() => jest.clearAllMocks());

    it.each([
      ['an array of ids', { userIds: [uuid(1)] }, [uuid(1)]],
      ['a single id', { userIds: uuid(1) }, [uuid(1)]],
      ['an array of { id }', { userIds: [{ id: uuid(1) }] }, [uuid(1)]],
      ['a single { userId }', { userIds: { userId: uuid(1) } }, [uuid(1)]],
      ['an array with an empty entry', { userIds: [uuid(1), ''] }, [uuid(1)]],
    ])('still accepts %s', async (_l, body, expected) => {
      await start(body).expect(201);
      expect(service.startConversation).toHaveBeenCalledWith(
        expected,
        'user-1',
        undefined,
      );
    });

    it('starts a named group, and falls back to the query string with no body ids', async () => {
      await start({ userIds: [uuid(1), uuid(2)], name: 'Trip' }).expect(201);
      expect(service.startConversation).toHaveBeenLastCalledWith(
        [uuid(1), uuid(2)],
        'user-1',
        'Trip',
      );
      await start({}, `?userIds=${uuid(1)},${uuid(2)}`).expect(201);
      expect(service.startConversation).toHaveBeenLastCalledWith(
        [uuid(1), uuid(2)],
        'user-1',
        undefined,
      );
    });

    it('holds the query string to the same cap and id rules as the body', async () => {
      // It used to be a raw split: uncapped, and anything reached the service.
      await start(
        {},
        `?userIds=${uuids(MAX_NEW_GROUP_MEMBERS).join(',')}`,
      ).expect(201);
      await start(
        {},
        `?userIds=${uuids(MAX_NEW_GROUP_MEMBERS + 1).join(',')}`,
      ).expect(400);
      await start({}, '?userIds=a,b').expect(400);
      expect(service.startConversation).toHaveBeenCalledTimes(1);
    });

    it('accepts the cap and refuses one more', async () => {
      await start({ userIds: uuids(MAX_NEW_GROUP_MEMBERS) }).expect(201);
      await start({ userIds: uuids(MAX_NEW_GROUP_MEMBERS + 1) }).expect(400);
      expect(service.startConversation).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['ids that are not UUIDs', { userIds: ['x'] }],
      ['numeric entries', { userIds: [5] }],
      ['null entries', { userIds: [null] }],
      ['nested arrays', { userIds: [[uuid(1)]] }],
      ['an object id that is not a string', { userIds: [{ id: 5 }] }],
      [
        'an over-long name',
        { userIds: [uuid(1)], name: 'n'.repeat(MAX_GROUP_NAME_LENGTH + 1) },
      ],
      ['a numeric name', { userIds: [uuid(1)], name: 5 }],
      ['an undeclared field', { userIds: [uuid(1)], a: 1 }],
    ])('refuses %s', async (_l, body) => {
      await start(body).expect(400);
      expect(service.startConversation).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/dm (start a DM)', () => {
    let app: INestApplication<Server>;
    const startDM = spy({ id: 'dm-1' });
    const forwardMessage = spy({ messages: [] });
    const reactToMessage = spy({ success: true });
    const muteConversation = spy({ success: true });
    const pinConversation = spy({ success: true });
    const http = () => request(app.getHttpServer());

    beforeAll(async () => {
      app = await createPaginationApp({
        controller: DmController,
        guards: [JwtGuard],
        validate: true,
        providers: [
          {
            provide: DmService,
            useValue: {
              startDM,
              forwardMessage,
              reactToMessage,
              muteConversation,
              pinConversation,
            },
          },
          { provide: BlocksService, useValue: {} },
          { provide: VerificationAccessService, useValue: {} },
          ...commonProviders,
        ],
      });
    });
    afterAll(async () => {
      await app.close();
    });
    beforeEach(() => jest.clearAllMocks());

    it.each([
      ['targetUserId', { targetUserId: uuid(1) }],
      ['an array of ids', { userIds: [uuid(1)] }],
      ['a single id', { userIds: uuid(1) }],
    ])('starts a DM from %s', async (_l, body) => {
      await http().post('/api/dm').send(body).expect(201);
      expect(startDM).toHaveBeenCalledWith('user-1', uuid(1));
    });

    it.each([
      ['no target', {}],
      ['a target that is not a UUID', { targetUserId: 'someone' }],
      ['a numeric target', { targetUserId: 5 }],
      ['ids as objects', { userIds: [{ id: uuid(1) }] }],
      ['too many ids', { userIds: uuids(MAX_NEW_GROUP_MEMBERS + 1) }],
      ['an undeclared field', { targetUserId: uuid(1), a: 1 }],
    ])('refuses %s', async (_l, body) => {
      await http().post('/api/dm').send(body).expect(400);
      expect(startDM).not.toHaveBeenCalled();
    });

    it('validates forward, react, mute and pin on the DM routes too', async () => {
      await http()
        .post('/api/dm/msg/m1/forward')
        .send({ targetConversationIds: ids(MAX_FORWARD_TARGETS) })
        .expect(201);
      await http()
        .post('/api/dm/msg/m1/forward')
        .send({ targetConversationIds: ids(MAX_FORWARD_TARGETS + 1) })
        .expect(400);
      await http()
        .post('/api/dm/m1/react')
        .send({ reaction: '👍' })
        .expect(201);
      await http().post('/api/dm/m1/react').send({ reaction: 3 }).expect(400);
      await http().patch('/api/dm/c1/mute').send({ muted: true }).expect(200);
      await http().patch('/api/dm/c1/mute').send({ muted: 'yes' }).expect(400);
      await http().patch('/api/dm/c1/pin').send({ pinned: true }).expect(200);
      await http().patch('/api/dm/c1/pin').send({ pinned: 1 }).expect(400);
      expect(forwardMessage).toHaveBeenCalledTimes(1);
      expect(reactToMessage).toHaveBeenCalledTimes(1);
      expect(muteConversation).toHaveBeenCalledTimes(1);
      expect(pinConversation).toHaveBeenCalledTimes(1);
    });
  });
});
