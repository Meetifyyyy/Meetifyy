import { BadRequestException } from '@nestjs/common';
import { PostsService } from './posts.service';
import { createStudentYearPolicyMock } from '../common/student-year/testing/student-year-policy.mock';

describe('PostsService — poll options validation', () => {
  let service: PostsService;
  let prisma: any;
  let mentionsService: any;

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn(async () => ({ id: 'u1' })) },
      post: {
        create: jest.fn(async (args) => ({
          id: 'p1',
          text: args.data.text,
          authorId: args.data.authorId,
          media: [],
        })),
      },
      pollOption: {
        createMany: jest.fn(async () => ({ count: 2 })),
        findMany: jest.fn(async () => [
          { id: 'opt1', text: 'Option 1' },
          { id: 'opt2', text: 'Option 2' },
        ]),
      },
    };
    mentionsService = {
      sanitize: jest.fn(async () => []),
    };

    service = new PostsService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      { emit: jest.fn() } as any,
      {} as any,
      mentionsService,
      {} as any,
      {} as any,
      createStudentYearPolicyMock() as any,
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
