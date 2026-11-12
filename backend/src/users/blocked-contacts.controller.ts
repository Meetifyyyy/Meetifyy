import {
  Controller,
  Get,
  Delete,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';
import { UsersService } from './users.service';
import { JwtGuard } from '../common/guards/jwt.guard';
import { OffsetPipe, PageLimitPipe } from '../common/pagination';

/**
 * Settings -> Privacy -> Blocked Contacts.
 *
 * The blocked list is readable only by its owner. There is deliberately no
 * `:userId` route here: the subject is always taken from the JWT, so no request
 * can be shaped to read somebody else's blocked list.
 */
@Controller('api/settings')
export class BlockedContactsController {
  constructor(private readonly usersService: UsersService) {}

  @Get('blocked-contacts')
  @UseGuards(JwtGuard)
  async getBlockedContacts(
    @Req() req: AuthenticatedRequest,
    @Query('limit', new PageLimitPipe({ default: 20, max: 50 }))
    limit: number,
    @Query('offset', new OffsetPipe({ max: 10000 }))
    offset: number,
  ) {
    return this.usersService.getBlockedContacts(req.user.id, limit, offset);
  }
}

/**
 * Unblock. Mirrors `DELETE /api/users/block/:targetUserId`, which stays in
 * place so existing clients keep working; both land on the same service call,
 * so the unblock side effects cannot drift between the two routes.
 */
@Controller('api/blocks')
export class BlocksController {
  constructor(private readonly usersService: UsersService) {}

  @Delete(':blockedUserId')
  @UseGuards(JwtGuard)
  async unblock(
    @Param('blockedUserId') blockedUserId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    // Silent by design: unblocking dispatches no notification, so the other
    // user never learns they were on the list or that they came off it.
    return this.usersService.unblockUser(req.user.id, blockedUserId);
  }
}
