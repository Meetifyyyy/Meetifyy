import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service';
import { AcademicsService } from '../academics/academics.service';

jest.mock('../auth/auth.service', () => ({ clearAuthSyncCache: jest.fn() }));

/**
 * `PATCH /api/users/me` — the profile write (pending item A4).
 *
 * The body stays an open record on purpose: every client, including installed
 * apps that ship a frozen frontend, sends whole form objects (the signup
 * handover sends everything the signup form collected), so a whitelisting DTO
 * would turn fields the service has always ignored into a 400. What changes is
 * that each field the service does read is narrowed before use.
 *
 * Typing the update honestly also exposed the A16 shape here: a cleared avatar
 * wrote the raw `avatarMediaId: null` while a new cover wrote the relation
 * (`coverMedia: { connect }`). Prisma rejects that mix — verified against the
 * development database with an id that cannot exist — so a request carrying
 * both failed with a 500.
 */
describe('UsersService.updateProfile', () => {
  const USER = 'user-1';

  const build = (mediaOwner: string | null = USER) => {
    const upsert = jest.fn(
      (args: {
        update: Record<string, unknown>;
        create: Record<string, unknown>;
      }) =>
        Promise.resolve({
          id: USER,
          username: 'sam',
          displayName: 'Sam',
          avatar: (args.update.avatar as string | null | undefined) ?? null,
          cover: (args.update.cover as string | null | undefined) ?? null,
        }),
    );
    const mediaFindMany = jest.fn(
      (args: { where: { objectKey: { in: string[] } } }) =>
        Promise.resolve(
          args.where.objectKey.in.map((objectKey) => ({
            objectKey,
            ownerId: mediaOwner,
          })),
        ),
    );
    const service = Object.create(UsersService.prototype) as UsersService;
    Object.assign(service, {
      prisma: {
        user: {
          findUnique: jest.fn(() =>
            Promise.resolve({
              email: 'sam@college.edu',
              username: 'sam',
              displayName: 'Sam',
              avatar: '/api/media/avatars/old.webp',
              cover: null,
            }),
          ),
          upsert,
        },
        // Who uploaded each requested key (ownership of attached images).
        media: {
          findMany: mediaFindMany,
        },
      },
      academicsService: new AcademicsService(),
      domainEventService: { emit: jest.fn(() => Promise.resolve()) },
      logger: { warn: jest.fn(), debug: jest.fn() },
    });
    return { service, upsert, mediaFindMany };
  };

  const update = (upsert: ReturnType<typeof build>['upsert']) =>
    upsert.mock.calls[0][0].update;
  const create = (upsert: ReturnType<typeof build>['upsert']) =>
    upsert.mock.calls[0][0].create;

  describe('media fields use one Prisma input style', () => {
    it('clears an avatar through the relation, so it can travel with a new cover', async () => {
      const { service, upsert } = build();
      await service.updateProfile(USER, {
        avatar: null,
        cover: '/api/media/profile-covers/new.webp',
      });

      expect(update(upsert)).toMatchObject({
        avatar: null,
        avatarMedia: { disconnect: true },
        cover: '/api/media/profile-covers/new.webp',
        coverMedia: { connect: { objectKey: 'profile-covers/new.webp' } },
      });
      expect(update(upsert)).not.toHaveProperty('avatarMediaId');
      expect(update(upsert)).not.toHaveProperty('coverMediaId');
    });

    it('never puts a disconnect into the create branch, which has nothing to disconnect', async () => {
      const { service, upsert } = build();
      await service.updateProfile(USER, { avatar: '', cover: '' });

      expect(create(upsert)).not.toHaveProperty('avatarMedia');
      expect(create(upsert)).not.toHaveProperty('coverMedia');
      expect(create(upsert)).not.toHaveProperty('avatarMediaId');
      expect(create(upsert)).toMatchObject({ avatar: null, cover: null });
    });
  });

  describe('attaching images', () => {
    it('refuses an image another user uploaded, and writes nothing', async () => {
      const { service, upsert } = build('someone-else');
      await expect(
        service.updateProfile(USER, {
          avatar: '/api/media/avatars/victims-photo.webp',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(upsert).not.toHaveBeenCalled();
    });

    it('refuses a foreign cover the same way', async () => {
      const { service, upsert } = build('someone-else');
      await expect(
        service.updateProfile(USER, {
          cover: '/api/media/profile-covers/victims-cover.webp',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(upsert).not.toHaveBeenCalled();
    });

    it('accepts an image the user uploaded', async () => {
      const { service, upsert } = build(USER);
      await service.updateProfile(USER, {
        avatar: '/api/media/avatars/mine.webp',
      });
      expect(update(upsert)).toMatchObject({
        avatarMedia: { connect: { objectKey: 'avatars/mine.webp' } },
      });
    });

    it('does not ask about a shared default or preset', async () => {
      const { service, upsert, mediaFindMany } = build('someone-else');
      await service.updateProfile(USER, {
        avatar: '/api/media/defaults/avatar-v2.webp',
      });
      expect(mediaFindMany).not.toHaveBeenCalled();
      expect(upsert).toHaveBeenCalled();
    });

    it('re-saving the avatar the user already has is always fine', async () => {
      const { service, upsert, mediaFindMany } = build('legacy-owner');
      await service.updateProfile(USER, {
        avatar: '/api/media/avatars/old.webp',
      });
      expect(mediaFindMany).not.toHaveBeenCalled();
      expect(upsert).toHaveBeenCalled();
    });
  });

  it('still ignores fields it never read, as every client relies on', async () => {
    const { service, upsert } = build();
    await expect(
      service.updateProfile(USER, {
        displayName: 'Sam R',
        firstName: 'Sam',
        college: { id: 'c1' },
        role: 'ADMIN',
        password: 'should-never-matter',
      }),
    ).resolves.toBeDefined();

    expect(update(upsert)).toEqual({ displayName: 'Sam R' });
  });

  it.each([
    [{ avatar: 42 }],
    [{ cover: { url: 'x' } }],
    [{ location: 7 }],
    [{ profileCompleted: 'yes' }],
    [{ email: ['a@b.c'] }],
  ])(
    'refuses a wrongly typed %j as a 400, not a database error',
    async (body) => {
      const { service, upsert } = build();
      await expect(service.updateProfile(USER, body)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(upsert).not.toHaveBeenCalled();
    },
  );
  describe('gender', () => {
    it('accepts an enum value and clearing it', async () => {
      const { service, upsert } = build();
      await service.updateProfile(USER, { gender: 'NON_BINARY' });
      expect(update(upsert)).toEqual({ gender: 'NON_BINARY' });

      const second = build();
      await second.service.updateProfile(USER, { gender: null });
      expect(update(second.upsert)).toEqual({ gender: null });
    });

    it.each([['robot'], [3], [{}]])('refuses %j', async (gender) => {
      const { service, upsert } = build();
      await expect(
        service.updateProfile(USER, { gender }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(upsert).not.toHaveBeenCalled();
    });
  });

  it("never writes an email from the body: that is the OTP flow's job", async () => {
    const { service, upsert } = build();
    await service.updateProfile(
      USER,
      { email: 'attacker@evil.com', bio: 'hi' },
      'sam@college.edu',
    );
    expect(update(upsert)).toEqual({ bio: 'hi' });
    expect(JSON.stringify(upsert.mock.calls[0][0])).not.toContain('evil.com');
  });
});
