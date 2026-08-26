import {
  Controller,
  Get,
  Delete,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtGuard } from '../common/guards/jwt.guard';

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
    @Req() req: any,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.usersService.getBlockedContacts(
      req.user.id,
      limit ? parseInt(limit, 10) || 20 : 20,
      offset ? parseInt(offset, 10) || 0 : 0,
    );
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
    @Req() req: any,
  ) {
    // Silent by design: unblocking dispatches no notification, so the other
    // user never learns they were on the list or that they came off it.
    return this.usersService.unblockUser(req.user.id, blockedUserId);
  }
}
