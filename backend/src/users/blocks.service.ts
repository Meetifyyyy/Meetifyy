import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BlocksService {
  constructor(private prisma: PrismaService) {}

  /**
   * Returns an array of user IDs that should be excluded for the given user.
   * This includes:
   * 1. Users that the given user has blocked.
   * 2. Users that have blocked the given user.
   */
  async getExcludedUserIds(userId: string): Promise<string[]> {
    const blocks = await this.prisma.block.findMany({
      where: {
        OR: [
          { blockerId: userId },
          { blockedId: userId },
        ],
      },
      select: {
        blockerId: true,
        blockedId: true,
      },
    });

    const excludedIds = new Set<string>();
    for (const block of blocks) {
      if (block.blockerId === userId) {
        excludedIds.add(block.blockedId);
      } else {
        excludedIds.add(block.blockerId);
      }
    }

    return Array.from(excludedIds);
  }
}
