import { MentionsService } from './mentions.service';
import { stub } from '../common/testing/stub';
import type { PrismaService } from '../prisma/prisma.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { NotificationFactory } from '../notifications/notification.factory';

/**
 * sanitize() decides who gets notified by a post, comment or message, so it
 * must not resolve people the author is blocked with (either direction) or
 * accounts that are not active.
 */
describe('MentionsService.sanitize', () => {
  const ACTOR = 'actor';
  const TEXT = 'hi @ann and @bob and @cy';
  const mention = (userId: string, username: string) => {
    const start = TEXT.indexOf(`@${username}`);
    return { userId, username, start, end: start + username.length + 1 };
  };

  const build = (
    users: Array<{ id: string; username: string }>,
    blocks: Array<{ blockerId: string; blockedId: string }> = [],
  ) => {
    const userFindMany = jest.fn(() => Promise.resolve(users));
    const blockFindMany = jest.fn(() => Promise.resolve(blocks));
    const service = new MentionsService(
      stub<PrismaService>({
        user: { findMany: userFindMany },
        block: { findMany: blockFindMany },
      }),
      stub<NotificationsService>(),
      stub<NotificationFactory>(),
    );
    return { service, userFindMany, blockFindMany };
  };

  const all = [mention('u1', 'ann'), mention('u2', 'bob'), mention('u3', 'cy')];
  const everyone = [
    { id: 'u1', username: 'ann' },
    { id: 'u2', username: 'bob' },
    { id: 'u3', username: 'cy' },
  ];

  it('keeps ordinary mentions', async () => {
    const { service } = build(everyone);
    const out = await service.sanitize(TEXT, all, ACTOR);
    expect(out.map((m) => m.userId)).toEqual(['u1', 'u2', 'u3']);
  });

  it('drops someone the author blocked', async () => {
    const { service } = build(everyone, [
      { blockerId: ACTOR, blockedId: 'u2' },
    ]);
    const out = await service.sanitize(TEXT, all, ACTOR);
    expect(out.map((m) => m.userId)).toEqual(['u1', 'u3']);
  });

  it('drops someone who blocked the author', async () => {
    const { service } = build(everyone, [
      { blockerId: 'u3', blockedId: ACTOR },
    ]);
    const out = await service.sanitize(TEXT, all, ACTOR);
    expect(out.map((m) => m.userId)).toEqual(['u1', 'u2']);
  });

  it('only resolves active, non-deleted accounts', async () => {
    const { service, userFindMany } = build(everyone);
    await service.sanitize(TEXT, all, ACTOR);
    const [args] = userFindMany.mock.calls[0] as unknown as [
      { where: Record<string, unknown> },
    ];
    expect(args.where).toMatchObject({
      deletedAt: null,
      accountStatus: 'ACTIVE',
    });
  });

  it('looks up blocks for the candidates in both directions, in one query', async () => {
    const { service, blockFindMany } = build(everyone);
    await service.sanitize(TEXT, all, ACTOR);
    expect(blockFindMany).toHaveBeenCalledTimes(1);
    expect(blockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { blockerId: ACTOR, blockedId: { in: ['u1', 'u2', 'u3'] } },
            { blockedId: ACTOR, blockerId: { in: ['u1', 'u2', 'u3'] } },
          ],
        },
      }),
    );
  });

  it('does no lookups when there is nothing to resolve', async () => {
    const { service, userFindMany, blockFindMany } = build(everyone);
    expect(await service.sanitize(TEXT, [], ACTOR)).toEqual([]);
    expect(userFindMany).not.toHaveBeenCalled();
    expect(blockFindMany).not.toHaveBeenCalled();
  });
});
