import { UsersService } from './users.service';
import { clearAuthSyncCache } from '../auth/auth.service';

jest.mock('../auth/auth.service', () => ({ clearAuthSyncCache: jest.fn() }));

describe('UsersService.snoozeProfilePrompt', () => {
  const build = () => {
    const updateMany = jest.fn(() => Promise.resolve({ count: 1 }));
    const service = Object.create(UsersService.prototype) as UsersService;
    Object.assign(service, { prisma: { user: { updateMany } } });
    return { service, updateMany };
  };

  beforeEach(() => jest.clearAllMocks());

  it('stamps now and the current session id, and drops the cached profile', async () => {
    const { service, updateMany } = build();
    const before = Date.now();

    await expect(service.snoozeProfilePrompt('u1', 'sess-a')).resolves.toEqual({
      snoozed: true,
    });

    expect(updateMany).toHaveBeenCalledTimes(1);
    const call = (
      updateMany.mock.calls as unknown as Array<
        [
          {
            where: { id: string };
            data: {
              profilePromptLaterAt: Date;
              profilePromptLaterSessionId: string;
            };
          },
        ]
      >
    )[0][0];
    expect(call.where).toEqual({ id: 'u1' });
    expect(call.data.profilePromptLaterSessionId).toBe('sess-a');
    expect(call.data.profilePromptLaterAt.getTime()).toBeGreaterThanOrEqual(
      before,
    );
    expect(clearAuthSyncCache).toHaveBeenCalledWith('u1');
  });

  it('is idempotent: pressing again just restamps', async () => {
    const { service, updateMany } = build();
    await service.snoozeProfilePrompt('u1', 'sess-a');
    await service.snoozeProfilePrompt('u1', 'sess-a');
    expect(updateMany).toHaveBeenCalledTimes(2);
  });

  it('records nothing for a caller with no resolvable session id', async () => {
    const { service, updateMany } = build();
    await expect(service.snoozeProfilePrompt('u1', null)).resolves.toEqual({
      snoozed: false,
    });
    expect(updateMany).not.toHaveBeenCalled();
  });
});
