import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PushPlatform } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { config } from '../config';
import {
  RegisterPushDeviceDto,
  UpdatePushPreferencesDto,
} from './dto/register-push-device.dto';
import { CATEGORY_COLUMN, PUSH_CATEGORIES, PushCategory } from './push.types';

/** Newest registrations kept per user; older ones are dropped on register. */
export const MAX_DEVICES_PER_USER = 10;

/**
 * Hosts a Web Push endpoint may live on.
 *
 * The server POSTs to whatever endpoint a client registers, so an open list
 * would let any signed-in user point the API at an internal address (SSRF).
 * These are the push services the supported browsers use: Chrome/Edge/Opera
 * (FCM), Firefox (Mozilla autopush), Safari (Apple), Edge legacy (WNS).
 */
const WEB_PUSH_HOSTS: ReadonlyArray<{ host: string; suffix: boolean }> = [
  { host: 'fcm.googleapis.com', suffix: false },
  { host: 'updates.push.services.mozilla.com', suffix: false },
  { host: 'push.services.mozilla.com', suffix: true },
  { host: 'web.push.apple.com', suffix: false },
  { host: 'push.apple.com', suffix: true },
  { host: 'notify.windows.com', suffix: true },
];

/** True when `endpoint` is an https URL on an allowed push service, with nothing unusual about it. */
export function isAllowedWebPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  if (url.port && url.port !== '443') return false;
  const host = url.hostname.toLowerCase();
  return WEB_PUSH_HOSTS.some(({ host: allowed, suffix }) =>
    suffix ? host.endsWith(`.${allowed}`) : host === allowed,
  );
}

/** FCM registration tokens: URL-safe base64 with `:` separators. */
const FCM_TOKEN = /^[A-Za-z0-9_:-]{20,2048}$/;

export interface PushPreferencesView {
  /** Account-wide switch (UserSettings.pushNotifs). */
  enabled: boolean;
  categories: Record<PushCategory, boolean>;
}

@Injectable()
export class PushDevicesService {
  constructor(private readonly prisma: PrismaService) {}

  /** What the client needs to subscribe. Nothing here is secret. */
  clientConfig(): {
    enabled: boolean;
    webPushPublicKey: string | null;
    web: boolean;
    android: boolean;
  } {
    const enabled = config.push.enabled;
    return {
      enabled,
      webPushPublicKey: config.push.web.configured
        ? config.push.web.publicKey
        : null,
      web: enabled && config.push.web.configured,
      android: enabled && config.push.fcm.configured,
    };
  }

  /**
   * Registers (or refreshes) this device for the caller.
   *
   * Identity is the authenticated user and their current login; nothing in the
   * body names a user. Upserted on the token: a token already held by another
   * account moves to this one, which is exactly what happens when a second
   * person signs in on the same phone or browser profile.
   */
  async register(
    userId: string,
    sessionId: string | null,
    dto: RegisterPushDeviceDto,
  ): Promise<{ registered: true }> {
    const platform =
      dto.platform === 'WEB' ? PushPlatform.WEB : PushPlatform.ANDROID;
    if (platform === PushPlatform.WEB) {
      if (!isAllowedWebPushEndpoint(dto.token)) {
        throw new BadRequestException('Unsupported push endpoint');
      }
      if (!dto.p256dh || !dto.auth) {
        throw new BadRequestException('Web push subscriptions need their keys');
      }
    } else if (!FCM_TOKEN.test(dto.token) || dto.p256dh || dto.auth) {
      throw new BadRequestException('Invalid device token');
    }

    // The login this registration dies with. A request with no live session
    // (there is none for a bare bearer token) cannot register a device,
    // because nothing would ever revoke it.
    const session = sessionId
      ? await this.prisma.userSession.findFirst({
          where: { id: sessionId, userId, revoked: false },
          select: { familyId: true },
        })
      : null;
    if (!session) {
      throw new ForbiddenException(
        'A signed-in session is required to enable notifications',
      );
    }

    const fields = {
      userId,
      platform,
      familyId: session.familyId,
      p256dh: platform === PushPlatform.WEB ? (dto.p256dh ?? null) : null,
      auth: platform === PushPlatform.WEB ? (dto.auth ?? null) : null,
      appVersion: dto.appVersion ?? null,
      lastSeenAt: new Date(),
      failureCount: 0,
    };
    await this.prisma.pushDevice.upsert({
      where: { token: dto.token },
      create: { token: dto.token, ...fields },
      update: fields,
    });

    await this.pruneBeyondCap(userId);
    return { registered: true };
  }

  /** Removes the caller's own registration. Somebody else's token matches nothing. */
  async unregister(
    userId: string,
    token: string,
  ): Promise<{ removed: boolean }> {
    const result = await this.prisma.pushDevice.deleteMany({
      where: { token, userId },
    });
    return { removed: result.count > 0 };
  }

  private async pruneBeyondCap(userId: string): Promise<void> {
    const stale = await this.prisma.pushDevice.findMany({
      where: { userId },
      orderBy: { lastSeenAt: 'desc' },
      skip: MAX_DEVICES_PER_USER,
      select: { id: true },
    });
    if (stale.length > 0) {
      await this.prisma.pushDevice.deleteMany({
        where: { id: { in: stale.map((d) => d.id) }, userId },
      });
    }
  }

  async getPreferences(userId: string): Promise<PushPreferencesView> {
    const [settings, prefs] = await Promise.all([
      this.prisma.userSettings.findUnique({
        where: { userId },
        select: { pushNotifs: true },
      }),
      this.prisma.notificationPreferences.findUnique({ where: { userId } }),
    ]);
    const categories = {} as Record<PushCategory, boolean>;
    for (const category of PUSH_CATEGORIES) {
      categories[category] = prefs ? prefs[CATEGORY_COLUMN[category]] : true;
    }
    return { enabled: settings?.pushNotifs ?? false, categories };
  }

  async updatePreferences(
    userId: string,
    dto: UpdatePushPreferencesDto,
  ): Promise<PushPreferencesView> {
    const data: Partial<
      Record<(typeof CATEGORY_COLUMN)[PushCategory], boolean>
    > = {};
    for (const category of PUSH_CATEGORIES) {
      const value = dto[category];
      if (typeof value === 'boolean') data[CATEGORY_COLUMN[category]] = value;
    }
    const writes: Promise<unknown>[] = [];
    if (Object.keys(data).length > 0) {
      writes.push(
        this.prisma.notificationPreferences.upsert({
          where: { userId },
          create: { userId, ...data },
          update: data,
        }),
      );
    }
    if (typeof dto.enabled === 'boolean') {
      writes.push(
        this.prisma.userSettings.upsert({
          where: { userId },
          create: { userId, pushNotifs: dto.enabled },
          update: { pushNotifs: dto.enabled },
        }),
      );
    }
    // No cache to evict: the push worker reads these at send time, and the
    // in-app gate cached by NotificationsService never reads push columns.
    await Promise.all(writes);
    return this.getPreferences(userId);
  }
}
