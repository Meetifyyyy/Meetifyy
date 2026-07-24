import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AdminFlagsService {
  constructor(private readonly prisma: PrismaService) {}

  async listFlags() {
    return this.prisma.featureFlag.findMany({
      orderBy: { key: 'asc' },
    });
  }

  async upsertFlag(dto: {
    key: string;
    enabled: boolean;
    description?: string;
    rolloutPercentage?: number;
  }) {
    return this.prisma.featureFlag.upsert({
      where: { key: dto.key.trim().toLowerCase() },
      update: {
        enabled: dto.enabled,
        description: dto.description || null,
        rolloutPercentage: dto.rolloutPercentage ?? 100,
      },
      create: {
        key: dto.key.trim().toLowerCase(),
        enabled: dto.enabled,
        description: dto.description || null,
        rolloutPercentage: dto.rolloutPercentage ?? 100,
      },
    });
  }

  async deleteFlag(key: string) {
    const flag = await this.prisma.featureFlag.findUnique({ where: { key } });
    if (!flag) throw new NotFoundException(`Flag '${key}' not found`);

    await this.prisma.featureFlag.delete({ where: { key } });
    return { success: true };
  }
}
