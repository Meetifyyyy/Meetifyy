import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class KeysService {
  constructor(private prisma: PrismaService) {}

  async registerDevice(userId: string, data: any) {
    const { registrationId, identityKey, signedPreKeyId, signedPreKey, signedPreKeySig, oneTimePreKeys } = data;

    // Create a new device for this user
    const device = await this.prisma.device.create({
      data: {
        userId,
        registrationId,
        identityKey,
        signedPreKeyId,
        signedPreKey,
        signedPreKeySig,
        oneTimePreKeys: {
          create: oneTimePreKeys.map((k: any) => ({
            keyId: k.keyId,
            key: k.key,
          })),
        },
      },
    });

    return { deviceId: device.id, success: true };
  }

  async fetchPreKeyBundle(userId: string) {
    // Get all devices for the target user
    const devices = await this.prisma.device.findMany({
      where: { userId },
      include: {
        oneTimePreKeys: {
          take: 1, // Only need one preKey per session establishment
        },
      },
    });

    if (!devices || devices.length === 0) {
      return { bundles: [] };
    }

    const bundles = [];

    for (const device of devices) {
      let preKey = null;
      if (device.oneTimePreKeys.length > 0) {
        preKey = device.oneTimePreKeys[0];
        // Delete the one-time preKey as it's being used
        await this.prisma.oneTimePreKey.delete({
          where: { id: preKey.id },
        });
      }

      bundles.push({
        deviceId: device.id,
        registrationId: device.registrationId,
        identityKey: device.identityKey,
        signedPreKey: {
          keyId: device.signedPreKeyId,
          publicKey: device.signedPreKey,
          signature: device.signedPreKeySig,
        },
        preKey: preKey ? {
          keyId: preKey.keyId,
          publicKey: preKey.key,
        } : null,
      });
    }

    return { bundles };
  }

  async getOpkStatus(userId: string, deviceId?: string) {
    let targetDeviceId = deviceId;

    if (!targetDeviceId && userId) {
      const latestDevice = await this.prisma.device.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' }
      });
      if (latestDevice) {
        targetDeviceId = latestDevice.id;
      }
    }

    if (!targetDeviceId) {
      return { opkCount: 0, deviceId: null };
    }

    const count = await this.prisma.oneTimePreKey.count({
      where: { deviceId: targetDeviceId }
    });

    return { opkCount: count, deviceId: targetDeviceId };
  }

  async replenishOpks(userId: string, deviceId: string, oneTimePreKeys: any[]) {
    if (!deviceId) throw new BadRequestException("Device ID required");
    
    // Verify device belongs to user
    const device = await this.prisma.device.findUnique({
      where: { id: deviceId }
    });
    
    if (!device || device.userId !== userId) {
      throw new ForbiddenException("Invalid device");
    }

    await this.prisma.oneTimePreKey.createMany({
      data: (oneTimePreKeys || []).map(k => ({
        deviceId,
        keyId: k.keyId,
        key: k.key
      }))
    });

    return { success: true };
  }

  async rotateSpk(userId: string, deviceId: string, data: any) {
    if (!deviceId) throw new BadRequestException("Device ID required");
    const { signedPreKeyId, signedPreKey, signedPreKeySig } = data;

    const device = await this.prisma.device.findUnique({
      where: { id: deviceId }
    });

    if (!device || device.userId !== userId) {
      throw new ForbiddenException("Invalid device");
    }

    await this.prisma.device.update({
      where: { id: deviceId },
      data: {
        signedPreKeyId,
        signedPreKey,
        signedPreKeySig
      }
    });

    return { success: true };
  }
}
