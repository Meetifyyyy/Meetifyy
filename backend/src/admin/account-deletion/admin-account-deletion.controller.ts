import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import {
  AdminAccountDeletionService,
  DeletionQueueFilter,
} from './admin-account-deletion.service';

/**
 * Account Deletion — its own admin section, not a tab inside Users or
 * Moderation. Deletion requests are a data-retention obligation with a
 * deadline, which is a different job from moderating someone: the queue is
 * ordered by that deadline and its actions are about meeting it.
 */
@UseGuards(AdminJwtGuard)
@Controller('admin/account-deletion')
export class AdminAccountDeletionController {
  constructor(private readonly service: AdminAccountDeletionService) {}

  @Get()
  async list(
    @Query('filter') filter?: DeletionQueueFilter,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.list({
      filter,
      search,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  /** Runs one purge sweep now. Static route, so it precedes `:userId`. */
  @Post('run-sweep')
  async runSweep() {
    return this.service.runSweep();
  }

  @Get(':userId')
  async getOne(@Param('userId') userId: string) {
    return this.service.getOne(userId);
  }

  /** Cancel a pending deletion on the owner's behalf. */
  @Post(':userId/restore')
  async restore(@Param('userId') userId: string) {
    return this.service.restore(userId);
  }

  /** Retry a failed purge, or complete one without waiting for the sweep. */
  @Post(':userId/purge')
  async purgeNow(@Param('userId') userId: string) {
    return this.service.purgeNow(userId);
  }
}
