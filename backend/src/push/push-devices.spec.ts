import 'reflect-metadata';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PushPlatform } from '@prisma/client';
import { stub } from '../common/testing/stub';
import { PrismaService } from '../prisma/prisma.service';
import {
  MAX_DEVICES_PER_USER,
  PushDevicesService,
  isAllowedWebPushEndpoint,
} from './push-devices.service';
import { PushController } from './push.controller';
import {
  RegisterPushDeviceDto,
  UpdatePushPreferencesDto,
} from './dto/register-push-device.dto';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';

const P256 = 'B' + 'A'.repeat(86); // 87 base64url chars = a 65-byte key
const AUTH = 'a'.repeat(22); // 16 bytes
const WEB_ENDPOINT =
  'https://fcm.googleapis.com/fcm/send/abcdefghijklmnopqrstuvwxyz';
const FCM_TOKEN = 'dGVzdC10b2tlbg:APA91bH' + 'x'.repeat(120);

function makePrisma() {
  return {
    userSession: {
      findFirst: jest.fn<Promise<{ familyId: string } | null>, [unknown]>(),
    },
    pushDevice: {
      upsert: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({}),
      deleteMany: jest
        .fn<Promise<{ count: number }>, [unknown]>()
        .mockResolvedValue({ count: 1 }),
      findMany: jest
        .fn<Promise<{ id: string }[]>, [unknown]>()
        .mockResolvedValue([]),
    },
    userSettings: {
      findUnique: jest.fn().mockResolvedValue({ pushNotifs: true }),
      upsert: jest.fn().mockResolvedValue({}),
    },
    notificationPreferences: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
    },
  };
}

function build() {
  const prisma = makePrisma();
  const service = new PushDevicesService(stub<PrismaService>(prisma));
  return { prisma, service };
}

describe('PushDevicesService - registration', () => {
  it('registers to the authenticated user and their login family, never a body id', async () => {
    const { prisma, service } = build();
    prisma.userSession.findFirst.mockResolvedValue({ familyId: 'fam-1' });
    await service.register('user-a', 'sess-1', {
      platform: 'ANDROID',
      token: FCM_TOKEN,
    });
    expect(prisma.userSession.findFirst).toHaveBeenCalledWith({
      where: { id: 'sess-1', userId: 'user-a', revoked: false },
      select: { familyId: true },
    });
    const call = prisma.pushDevice.upsert.mock.calls[0][0] as {
      where: { token: string };
      update: { userId: string; familyId: string; platform: PushPlatform };
    };
    expect(call.where).toEqual({ token: FCM_TOKEN });
    expect(call.update.userId).toBe('user-a');
    expect(call.update.familyId).toBe('fam-1');
    expect(call.update.platform).toBe(PushPlatform.ANDROID);
  });

  it("refuses without a live session of the caller's own (cannot borrow another user's)", async () => {
    const { prisma, service } = build();
    prisma.userSession.findFirst.mockResolvedValue(null);
    await expect(
      service.register('user-a', 'someone-elses-session', {
        platform: 'ANDROID',
        token: FCM_TOKEN,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.register('user-a', null, {
        platform: 'ANDROID',
        token: FCM_TOKEN,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.pushDevice.upsert).not.toHaveBeenCalled();
  });

  it('rejects a web endpoint that is not a known push service (SSRF)', async () => {
    const { prisma, service } = build();
    prisma.userSession.findFirst.mockResolvedValue({ familyId: 'fam-1' });
    for (const token of [
      'http://fcm.googleapis.com/fcm/send/abcdefghijklmnop',
      'https://169.254.169.254/latest/meta-data/iam',
      'https://localhost:4000/api/admin/something-long',
      'https://fcm.googleapis.com.evil.example/fcm/send/abc',
      'https://user:pw@fcm.googleapis.com/fcm/send/abcdefg',
      'https://fcm.googleapis.com:8443/fcm/send/abcdefghij',
    ]) {
      await expect(
        service.register('user-a', 'sess-1', {
          platform: 'WEB',
          token,
          p256dh: P256,
          auth: AUTH,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(prisma.pushDevice.upsert).not.toHaveBeenCalled();
  });

  it('accepts the real push services', () => {
    for (const endpoint of [
      WEB_ENDPOINT,
      'https://updates.push.services.mozilla.com/wpush/v2/gAAAA',
      'https://web.push.apple.com/QGs1-abc',
      'https://wns2-par02p.notify.windows.com/w/?token=abc',
    ]) {
      expect(isAllowedWebPushEndpoint(endpoint)).toBe(true);
    }
  });

  it('requires web keys for WEB and forbids them for ANDROID', async () => {
    const { prisma, service } = build();
    prisma.userSession.findFirst.mockResolvedValue({ familyId: 'fam-1' });
    await expect(
      service.register('user-a', 'sess-1', {
        platform: 'WEB',
        token: WEB_ENDPOINT,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.register('user-a', 'sess-1', {
        platform: 'ANDROID',
        token: FCM_TOKEN,
        p256dh: P256,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.register('user-a', 'sess-1', {
        platform: 'ANDROID',
        token: 'not a token!' + 'x'.repeat(20),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it(`keeps at most ${MAX_DEVICES_PER_USER} devices, scoped to the caller`, async () => {
    const { prisma, service } = build();
    prisma.userSession.findFirst.mockResolvedValue({ familyId: 'fam-1' });
    prisma.pushDevice.findMany.mockResolvedValue([
      { id: 'old-1' },
      { id: 'old-2' },
    ]);
    await service.register('user-a', 'sess-1', {
      platform: 'ANDROID',
      token: FCM_TOKEN,
    });
    expect(prisma.pushDevice.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['old-1', 'old-2'] }, userId: 'user-a' },
    });
  });

  it("unregister can only remove the caller's own row", async () => {
    const { prisma, service } = build();
    prisma.pushDevice.deleteMany.mockResolvedValue({ count: 0 });
    const res = await service.unregister('user-a', FCM_TOKEN);
    expect(prisma.pushDevice.deleteMany).toHaveBeenCalledWith({
      where: { token: FCM_TOKEN, userId: 'user-a' },
    });
    expect(res.removed).toBe(false);
  });

  it('preferences: master switch and categories write separately; in-app flags untouched', async () => {
    const { prisma, service } = build();
    await service.updatePreferences('user-a', { enabled: true, likes: false });
    expect(prisma.notificationPreferences.upsert).toHaveBeenCalledWith({
      where: { userId: 'user-a' },
      create: { userId: 'user-a', pushLikes: false },
      update: { pushLikes: false },
    });
    expect(prisma.userSettings.upsert).toHaveBeenCalledWith({
      where: { userId: 'user-a' },
      create: { userId: 'user-a', pushNotifs: true },
      update: { pushNotifs: true },
    });
  });
});

describe('PushController - identity comes from auth only', () => {
  it('passes req.user.id and the current session, ignoring anything else', async () => {
    const register = jest
      .fn<
        Promise<{ registered: true }>,
        [string, string | null, RegisterPushDeviceDto]
      >()
      .mockResolvedValue({ registered: true });
    const controller = new PushController(
      stub<PushDevicesService>({ register }),
    );
    const req = stub<AuthenticatedRequest>({
      user: { id: 'user-a' },
      headers: { 'x-session-id': 'sess-1' },
      cookies: {},
    });
    await controller.register(req, { platform: 'ANDROID', token: FCM_TOKEN });
    expect(register.mock.calls[0][0]).toBe('user-a');
  });
});

describe('push DTO validation', () => {
  const errorsFor = async (cls: new () => object, body: object) =>
    (
      await validate(plainToInstance(cls, body), {
        whitelist: true,
        forbidNonWhitelisted: true,
      })
    ).map((e) => e.property);

  it('accepts a well-formed web subscription', async () => {
    expect(
      await errorsFor(RegisterPushDeviceDto, {
        platform: 'WEB',
        token: WEB_ENDPOINT,
        p256dh: P256,
        auth: AUTH,
      }),
    ).toEqual([]);
  });

  it('rejects unknown platforms, a userId field, bad keys and oversize tokens', async () => {
    expect(
      await errorsFor(RegisterPushDeviceDto, {
        platform: 'IOS',
        token: FCM_TOKEN,
      }),
    ).toContain('platform');
    expect(
      await errorsFor(RegisterPushDeviceDto, {
        platform: 'ANDROID',
        token: FCM_TOKEN,
        userId: 'victim',
      }),
    ).toContain('userId');
    expect(
      await errorsFor(RegisterPushDeviceDto, {
        platform: 'WEB',
        token: WEB_ENDPOINT,
        p256dh: 'short',
        auth: AUTH,
      }),
    ).toContain('p256dh');
    expect(
      await errorsFor(RegisterPushDeviceDto, {
        platform: 'ANDROID',
        token: 'x'.repeat(3000),
      }),
    ).toContain('token');
  });

  it('preference toggles must be booleans', async () => {
    expect(
      await errorsFor(UpdatePushPreferencesDto, { likes: 'no' }),
    ).toContain('likes');
    expect(
      await errorsFor(UpdatePushPreferencesDto, {
        enabled: false,
        messages: true,
      }),
    ).toEqual([]);
  });
});
