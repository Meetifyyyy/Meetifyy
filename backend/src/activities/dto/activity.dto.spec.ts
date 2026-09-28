import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateActivityDto } from './activity.dto';

/**
 * CreateActivityDto through the global pipe, configured as main.ts configures
 * it. ActivitiesService.createActivity relies on this: it reads only the DTO's
 * fields, so an unlisted field such as the retired `whoCanJoin` has to be
 * refused here rather than ignored there.
 */
describe('CreateActivityDto through the global ValidationPipe', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const validate = (body: Record<string, unknown>) =>
    pipe.transform(body, { type: 'body', metatype: CreateActivityDto });

  it('accepts a body made of listed fields', async () => {
    const dto: unknown = await validate({
      title: 'Chess',
      visibility: 'PRIVATE',
      maxMembers: 4,
    });
    expect(dto).toBeInstanceOf(CreateActivityDto);
  });

  it('refuses the retired whoCanJoin field', async () => {
    await expect(
      validate({ title: 'Chess', whoCanJoin: 'Private' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a visibility outside the three modes', async () => {
    await expect(
      validate({ title: 'Chess', visibility: 'EVERYONE' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
