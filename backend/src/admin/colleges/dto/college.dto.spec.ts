import { BadRequestException, ValidationPipe } from '@nestjs/common';
import {
  ChangeCollegeStatusDto,
  CreateCollegeDto,
  UpdateCollegeDto,
} from './college.dto';

/**
 * The admin college routes took an `any` body (update), an inline type literal
 * (create — a type, not a class, so the pipe validated nothing) and a raw
 * `status` string handed to Prisma as an enum (pending item A4). They now take
 * DTOs through the same pipe options as main.ts.
 *
 * The accepted cases are exactly what the admin portal sends
 * (admin-frontend/src/pages/CollegesPage.tsx).
 */
describe('admin college DTOs', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const run = (metatype: new () => object, body: unknown) =>
    pipe.transform(body, { type: 'body', metatype });

  // The portal's form payload, for both create and edit.
  const formPayload = {
    name: 'GLA University',
    shortName: 'GLA',
    domains: ['gla.ac.in'],
    city: 'Mathura',
    state: 'Uttar Pradesh',
    country: 'India',
  };

  it('accepts the portal form for create and for edit', async () => {
    await expect(run(CreateCollegeDto, formPayload)).resolves.toEqual(
      formPayload,
    );
    await expect(run(UpdateCollegeDto, formPayload)).resolves.toEqual(
      formPayload,
    );
  });

  it('accepts a form with its optional fields left blank', async () => {
    const blank = { ...formPayload, shortName: '', city: '', state: '' };
    await expect(run(CreateCollegeDto, blank)).resolves.toEqual(blank);
  });

  it.each(['APPROVED', 'DISABLED', 'PENDING'])(
    'accepts the status %s',
    async (status) => {
      await expect(run(ChangeCollegeStatusDto, { status })).resolves.toEqual({
        status,
      });
    },
  );

  it.each([
    [UpdateCollegeDto, { deletedAt: null }],
    [UpdateCollegeDto, { id: 'another-id' }],
    [UpdateCollegeDto, { status: 'SUPERUSER' }],
    [UpdateCollegeDto, { domains: 'gla.ac.in' }],
    [CreateCollegeDto, { ...formPayload, isVerified: true }],
    [CreateCollegeDto, { name: 'No domains' }],
    [ChangeCollegeStatusDto, { status: 'approved-ish' }],
    [ChangeCollegeStatusDto, {}],
  ])('refuses %p %j', async (metatype, body) => {
    await expect(run(metatype, body)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
