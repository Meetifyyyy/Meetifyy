import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateCommunityDto } from './community.dto';

/**
 * CreateCommunityDto through the global pipe, configured as main.ts configures
 * it. CommunitiesService.createCommunity reads only the DTO's fields, so the
 * retired aliases (`desc`, `avatar`, `coverImage`) have to be refused here.
 */
describe('CreateCommunityDto through the global ValidationPipe', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const validate = (body: Record<string, unknown>) =>
    pipe.transform(body, { type: 'body', metatype: CreateCommunityDto });

  it('accepts a body made of listed fields', async () => {
    const dto: unknown = await validate({
      name: 'Chess club',
      description: 'Weekly games',
      avatarKey: '/api/media/avatars/a.webp',
      color: '#123456',
    });
    expect(dto).toBeInstanceOf(CreateCommunityDto);
  });

  it.each(['desc', 'avatar', 'coverImage'])(
    'refuses the retired %s alias',
    async (field) => {
      await expect(
        validate({ name: 'Chess club', [field]: 'x' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it.each([
    [199, true],
    [200, true],
    [201, true],
    [249, true],
    [250, true],
    [251, false],
  ])('description of %i characters: accepted=%s', async (length, accepted) => {
    const result = validate({
      name: 'Chess club',
      description: 'a'.repeat(length),
    });
    if (accepted) {
      await expect(result).resolves.toBeInstanceOf(CreateCommunityDto);
    } else {
      const error: unknown = await result.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect(
        JSON.stringify((error as BadRequestException).getResponse()),
      ).toMatch(/at most 250 characters/);
    }
  });
});
