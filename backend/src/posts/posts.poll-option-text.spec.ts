jest.mock('sanitize-html', () => ({
  __esModule: true,
  default: (s: string) => s,
}));
import { BadRequestException } from '@nestjs/common';
import { PostsService } from './posts.service';

/**
 * What createPost stores as poll options. The DTO only checks that `poll` is
 * an object, so `options` arrives as untrusted JSON.
 */
describe('PostsService.createPost poll option text', () => {
  const createMany = jest.fn((_args: { data: Array<{ text: string }> }) =>
    Promise.resolve({ count: 0 }),
  );

  const service = () => {
    const svc = Object.create(PostsService.prototype) as PostsService;
    Object.assign(svc, {
      logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
      mentionsService: { sanitize: jest.fn().mockResolvedValue([]) },
      domainEventService: { emit: jest.fn() },
      prisma: {
        post: {
          create: jest.fn().mockResolvedValue({
            id: 'p1',
            text: 'Which?',
            communityId: null,
            media: [],
            author: null,
          }),
        },
        pollOption: { createMany, findMany: jest.fn().mockResolvedValue([]) },
      },
    });
    return svc;
  };
  const storedTexts = () => createMany.mock.calls[0][0].data.map((o) => o.text);

  beforeEach(() => createMany.mockClear());

  it('stores trimmed strings, and numbers or booleans as text', async () => {
    await service().createPost('u1', 'Which?', undefined, undefined, {
      options: ['  Tea ', 3, true, '   '],
    });
    expect(storedTexts()).toEqual(['Tea', '3', 'true']);
  });

  it('drops an object or array option instead of storing "[object Object]"', async () => {
    await service().createPost('u1', 'Which?', undefined, undefined, {
      options: ['Tea', { text: 'Coffee' }, ['x']],
    });
    expect(storedTexts()).toEqual(['Tea']);
  });

  it('still refuses an over-long option', async () => {
    await expect(
      service().createPost('u1', 'Which?', undefined, undefined, {
        options: ['x'.repeat(101)],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
