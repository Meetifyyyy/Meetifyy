// EmailService pulls in sanitize-html, whose ESM dependency Jest cannot parse.
jest.mock('../../email/email.service', () => ({ EmailService: jest.fn() }));

import * as bcrypt from 'bcryptjs';
import type { ConfigService } from '@nestjs/config';
import { config } from '../../config';
import { AdminAuthService } from './admin-auth.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { EmailService } from '../../email/email.service';
import { stub } from '../../common/testing/stub';

/**
 * The Super Admin seed (SEC-14, ADM-3): it creates the admin from the
 * environment and keeps its password in step, but it never re-enables an
 * admin someone disabled in the database. That flag is the only kill switch.
 */
describe('Super Admin seed', () => {
  const EMAIL = 'owner@example.test';
  const PASSWORD = 'a-long-env-password';

  type Row = { email: string; passwordHash: string; isActive: boolean };
  const build = (existing: Row | null) => {
    const upsert = jest.fn((_args: unknown) => Promise.resolve({}));
    const service = new AdminAuthService(
      stub<PrismaService>({
        superAdmin: {
          findUnique: jest.fn(() => Promise.resolve(existing)),
          upsert,
        },
      }),
      stub<ConfigService>(),
      stub<EmailService>(),
    );
    jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
    jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
    return { service, upsert };
  };

  beforeEach(() => {
    jest.replaceProperty(config.auth.admin, 'superAdminEmail', EMAIL);
    jest.replaceProperty(config.auth.admin, 'superAdminPassword', PASSWORD);
  });
  afterEach(() => jest.restoreAllMocks());

  it('creates the admin when there is none', async () => {
    const { service, upsert } = build(null);
    await service.seedDefaultSuperAdmin();
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0]).toMatchObject({
      where: { email: EMAIL },
      create: { email: EMAIL, isActive: true },
    });
  });

  it('never re-enables an admin disabled in the database', async () => {
    const { service, upsert } = build({
      email: EMAIL,
      passwordHash: await bcrypt.hash('an-older-password', 4),
      isActive: false,
    });
    await service.seedDefaultSuperAdmin();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('rotates the password from the environment, and touches nothing else', async () => {
    const { service, upsert } = build({
      email: EMAIL,
      passwordHash: await bcrypt.hash('an-older-password', 4),
      isActive: true,
    });
    await service.seedDefaultSuperAdmin();
    expect(upsert).toHaveBeenCalledTimes(1);
    const { update } = upsert.mock.calls[0][0] as {
      update: Record<string, unknown>;
    };
    expect(Object.keys(update)).toEqual(['passwordHash']);
    expect(await bcrypt.compare(PASSWORD, String(update.passwordHash))).toBe(
      true,
    );
  });

  it('does nothing when the admin is active and the password unchanged', async () => {
    const { service, upsert } = build({
      email: EMAIL,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      isActive: true,
    });
    await service.seedDefaultSuperAdmin();
    expect(upsert).not.toHaveBeenCalled();
  });
});
