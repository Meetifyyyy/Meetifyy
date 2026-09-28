import { ValidationPipe, BadRequestException } from '@nestjs/common';
import { UpdateGroupSettingsDto } from './update-group-settings.dto';

/**
 * `PATCH /api/group-chats/:id/settings` and `PATCH /api/messages/:id/settings`
 * took `@Body() body: any`, which skips the global ValidationPipe entirely
 * (pending item A4). They now take this DTO — through the SAME pipe options as
 * main.ts, so an unexpected field is a 400.
 *
 * That is only safe if every payload a client has ever sent still passes:
 * installed apps ship a frozen copy of the frontend and keep calling this API
 * until their users update. The payloads below are every shape found in the
 * frontend's git history, including the human-readable values the first builds
 * wrote before the settings page moved to codes.
 */
describe('UpdateGroupSettingsDto', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const run = (body: unknown) =>
    pipe.transform(body, { type: 'body', metatype: UpdateGroupSettingsDto });

  describe('accepts every payload any build has sent', () => {
    it.each([
      // Current builds: one code per call.
      { groupUpdatesActive: false },
      { groupUpdatesActive: true },
      { whoCanJoin: 'ANYONE' },
      { whoCanJoin: 'APPROVAL' },
      { visibility: 'PUBLIC' },
      { visibility: 'COLLEGE' },
      { visibility: 'HIDDEN' },
      { allowSharing: true },
      { allowSharing: false },
      { editGroupPermission: 'ADMIN' },
      { editGroupPermission: 'EVERYONE' },
      // The first builds wrote display strings, including a university name.
      { whoCanJoin: 'Anyone' },
      { whoCanJoin: 'Request required' },
      { visibility: 'Hidden group' },
      { visibility: 'Visible only to Gla University' },
      { editGroupPermission: 'Everyone' },
      { editGroupPermission: 'Owner and Admins' },
    ])('%j', async (body) => {
      await expect(run(body)).resolves.toEqual(body);
    });
  });

  describe('refuses what the old `any` let through', () => {
    it.each([
      // Mass-assignment attempts: never columns this route may write.
      [{ ownerId: 'someone-else' }],
      [{ type: 'DM' }],
      [{ isInstantMatch: true }],
      // Wrong types that would otherwise reach Prisma and 500.
      [{ allowSharing: 'yes' }],
      [{ groupUpdatesActive: 1 }],
      [{ whoCanJoin: 42 }],
    ])('%j', async (body) => {
      await expect(run(body)).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
