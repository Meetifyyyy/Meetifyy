import { ForbiddenException } from '@nestjs/common';
import { stub } from '../../common/testing/stub';
import { PrismaService } from '../../prisma/prisma.service';
import { DomainEventService } from '../../events/domain-event.service';
import { ActivityAuthorizationService } from '../activity-authorization.service';
import { BlocksService } from '../../users/blocks.service';
import { ActivityDiscussionService } from './activity-discussion.service';

/**
 * Anyone who can view a public activity may read its discussion, but only the
 * host, joined members and accepted invitees may post, and only while the
 * activity is live.
 */
describe('ActivityDiscussionService — who may post', () => {
  type MemberRow = { userId: string; status: string };
  type InviteRow = {
    inviteeId: string;
    status: string;
    revokedAt: Date | null;
    expiresAt: Date | null;
  };

  const author = {
    id: 'me',
    username: 'me',
    displayName: 'Me',
    avatar: null,
    isCampusRep: false,
    accountStatus: 'ACTIVE',
    deletedAt: null,
  };

  const build = (
    opts: {
      status?: string;
      creatorId?: string;
      members?: MemberRow[];
      invitations?: InviteRow[];
    } = {},
  ) => {
    const create = jest.fn().mockResolvedValue({
      id: 'm1',
      text: 'hi',
      createdAt: new Date('2026-09-01T10:00:00Z'),
      userId: 'me',
      user: author,
    });
    const findMany = jest.fn().mockResolvedValue([]);
    const emit = jest.fn().mockResolvedValue(undefined);
    const service = new ActivityDiscussionService(
      stub<PrismaService>({
        activityDiscussionMessage: { create, findMany },
        crewActivity: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'act',
            creatorId: opts.creatorId ?? 'host',
            status: opts.status ?? 'OPEN',
            members: opts.members ?? [],
            invitations: opts.invitations ?? [],
          }),
        },
        user: { findUnique: jest.fn().mockResolvedValue({ id: 'me' }) },
      }),
      stub<DomainEventService>({ emit }),
      stub<ActivityAuthorizationService>({ assertCanView: jest.fn() }),
      stub<BlocksService>({
        isBlocked: jest.fn().mockResolvedValue(false),
        injectBlockFilter: jest.fn((_user: string, where: object) =>
          Promise.resolve(where),
        ),
      }),
    );
    return { service, create, findMany };
  };

  const invite = (over: Partial<InviteRow> = {}): InviteRow => ({
    inviteeId: 'me',
    status: 'ACCEPTED',
    revokedAt: null,
    expiresAt: null,
    ...over,
  });

  it('refuses a viewer who is not taking part', async () => {
    const { service, create } = build();
    await expect(service.sendMessage('act', 'me', 'hi')).rejects.toThrow(
      new ForbiddenException('Only people taking part can post here.'),
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('lets a joined member post', async () => {
    const { service, create } = build({
      members: [{ userId: 'me', status: 'MEMBER' }],
    });
    await service.sendMessage('act', 'me', 'hi');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('lets the host post', async () => {
    const { service, create } = build({ creatorId: 'me' });
    await service.sendMessage('act', 'me', 'hi');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('lets an accepted invitee post', async () => {
    const { service, create } = build({ invitations: [invite()] });
    await service.sendMessage('act', 'me', 'hi');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a pending member', { members: [{ userId: 'me', status: 'PENDING' }] }],
    ['a pending invitee', { invitations: [invite({ status: 'PENDING' })] }],
    ['a declined invitee', { invitations: [invite({ status: 'DECLINED' })] }],
    [
      'an accepted invitee whose invitation was revoked',
      { invitations: [invite({ revokedAt: new Date() })] },
    ],
  ])('refuses %s', async (_label, opts) => {
    const { service, create } = build(opts);
    await expect(service.sendMessage('act', 'me', 'hi')).rejects.toThrow(
      ForbiddenException,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ['ENDED', 'This activity has ended.'],
    ['CANCELLED', 'This activity was cancelled.'],
  ])('refuses a participant once the activity is %s', async (status, msg) => {
    const { service, create } = build({
      status,
      members: [{ userId: 'me', status: 'MEMBER' }],
    });
    await expect(service.sendMessage('act', 'me', 'hi')).rejects.toThrow(msg);
    expect(create).not.toHaveBeenCalled();
  });

  it.each(['OPEN', 'FULL'])('treats a %s activity as live', async (status) => {
    const { service, create } = build({
      status,
      members: [{ userId: 'me', status: 'MEMBER' }],
    });
    await service.sendMessage('act', 'me', 'hi');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('still lets a non-participant viewer read an ended discussion', async () => {
    const { service, findMany } = build({ status: 'ENDED' });
    await expect(service.getMessages('act', 'me')).resolves.toMatchObject({
      messages: [],
    });
    expect(findMany).toHaveBeenCalled();
  });
});
