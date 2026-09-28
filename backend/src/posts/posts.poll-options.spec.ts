import { BadRequestException } from '@nestjs/common';
import { PostsService } from './posts.service';
import { createStudentYearPolicyMock } from '../common/student-year/testing/student-year-policy.mock';
import { stub } from '../common/testing/stub';
import type { PrismaService } from '../prisma/prisma.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { NotificationFactory } from '../notifications/notification.factory';
import type { BlocksService } from '../users/blocks.service';
import type { DomainEventService } from '../events/domain-event.service';
import type { RedisService } from '../redis/redis.service';
import type { MentionsService } from '../mentions/mentions.service';
import type { StorageService } from '../uploads/uploads.service';
import type { ContentDeletionAuthorizer } from './content-deletion.authorizer';

const makePrisma = () => ({
  user: { findUnique: jest.fn(() => Promise.resolve({ id: 'u1' })) },
  post: {
    create: jest.fn((args: { data: { text: string; authorId: string } }) =>
      Promise.resolve({
        id: 'p1',
        text: args.data.text,
        authorId: args.data.authorId,
        media: [],
      }),
    ),
  },
  pollOption: {
    createMany: jest.fn(() => Promise.resolve({ count: 2 })),
    findMany: jest.fn(() =>
      Promise.resolve([
        { id: 'opt1', text: 'Option 1' },
        { id: 'opt2', text: 'Option 2' },
      ]),
    ),
  },
});

describe('PostsService — poll options validation', () => {
  let service: PostsService;
  let prisma: ReturnType<typeof makePrisma>;
  let mentionsService: { sanitize: jest.Mock };

  beforeEach(() => {
    prisma = makePrisma();
    mentionsService = {
      sanitize: jest.fn(() => Promise.resolve([])),
    };

    service = new PostsService(
      stub<PrismaService>(prisma),
      stub<NotificationsService>(),
      stub<NotificationFactory>(),
      stub<BlocksService>(),
      stub<DomainEventService>({ emit: jest.fn() }),
      stub<RedisService>(),
      stub<MentionsService>(mentionsService),
      stub<StorageService>(),
      stub<ContentDeletionAuthorizer>(),
      createStudentYearPolicyMock(),
    );
  });

  it('rejects post creation when a poll option exceeds 100 characters', async () => {
    const validOption = 'A'.repeat(100);
    const excessiveOption = 'B'.repeat(101);

    await expect(
      service.createPost('u1', 'Question?', undefined, undefined, {
        options: [validOption, excessiveOption],
      }),
    ).rejects.toThrow(
      new BadRequestException('Poll options cannot exceed 100 characters'),
    );

    // Verify post was never created in DB
    expect(prisma.post.create).not.toHaveBeenCalled();
  });

  it('allows post creation when poll options are within 100 characters', async () => {
    const option1 = 'Option 1';
    const option2 = 'A'.repeat(100);

    const result = await service.createPost(
      'u1',
      'Question?',
      undefined,
      undefined,
      {
        options: [option1, option2],
      },
    );

    expect(prisma.post.create).toHaveBeenCalled();
    expect(prisma.pollOption.createMany).toHaveBeenCalledWith({
      data: [
        { postId: 'p1', text: option1 },
        { postId: 'p1', text: option2 },
      ],
    });
    expect(result.pollOptions).toBeDefined();
  });
});
