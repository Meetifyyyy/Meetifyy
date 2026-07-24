import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AdminSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async listSettings() {
    return this.prisma.systemSetting.findMany({
      orderBy: { key: 'asc' },
    });
  }

  async upsertSetting(dto: {
    key: string;
    value: string;
    type?: string;
    description?: string;
  }) {
    return this.prisma.systemSetting.upsert({
      where: { key: dto.key.trim() },
      update: {
        value: dto.value,
        type: dto.type || 'string',
        description: dto.description || null,
      },
      create: {
        key: dto.key.trim(),
        value: dto.value,
        type: dto.type || 'string',
        description: dto.description || null,
      },
    });
  }
}
