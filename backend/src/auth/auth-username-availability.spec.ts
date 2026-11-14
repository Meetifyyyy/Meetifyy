import { AuthService } from './auth.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { SupabaseService } from '../supabase/supabase.service';
import type { DomainValidatorService } from '../common/services/domain-validator.service';
import type { DefaultAssetsService } from '../uploads/default-assets.service';
import { createLegalConsentMock } from '../common/legal/testing/legal-consent.mock';
import { stub } from '../common/testing/stub';

/**
 * The signup form's username check. Beyond the format, the reserved words and
 * a taken name, it refuses somebody's confession handle (FEAT-11), with the
 * same answer as a reserved name so it does not reveal the handle exists.
 */
describe('AuthService.checkUsernameAvailability', () => {
  const build = ({
    users = new Set<string>(),
    handles = new Set<string>(),
  } = {}) => {
    const handleFindUnique = jest.fn((args: { where: { handleKey: string } }) =>
      Promise.resolve(handles.has(args.where.handleKey) ? { id: 'p' } : null),
    );
    const service = new AuthService(
      stub<PrismaService>({
        user: {
          findUnique: jest.fn((args: { where: { username: string } }) =>
            Promise.resolve(
              users.has(args.where.username) ? { id: 'someone' } : null,
            ),
          ),
        },
        confessionProfile: { findUnique: handleFindUnique },
      }),
      stub<SupabaseService>({}),
      stub<DomainValidatorService>({}),
      stub<DefaultAssetsService>({}),
      createLegalConsentMock(),
    );
    return { service, handleFindUnique };
  };

  it('offers a free name', async () => {
    await expect(
      build().service.checkUsernameAvailability('ravi'),
    ).resolves.toEqual({ available: true });
  });

  it('refuses a confession handle exactly as it refuses a reserved name', async () => {
    const { service, handleFindUnique } = build({
      handles: new Set(['nightowl']),
    });
    const handle = await service.checkUsernameAvailability('NightOwl');
    const reserved = await service.checkUsernameAvailability('admin');
    expect(handle).toEqual({
      available: false,
      reason: 'Username not available',
    });
    expect(handle).toEqual(reserved);
    expect(handleFindUnique).toHaveBeenCalledWith({
      where: { handleKey: 'nightowl' },
      select: { id: true },
    });
  });

  it('still reports a taken name', async () => {
    await expect(
      build({ users: new Set(['ravi']) }).service.checkUsernameAvailability(
        'ravi',
      ),
    ).resolves.toEqual({ available: false, reason: 'Username not available' });
  });
});
