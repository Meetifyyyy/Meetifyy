import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';
import { UsersService } from './users.service';
import { JwtGuard } from '../common/guards/jwt.guard';
import { CacheControl } from '../common/decorators/cache-control.decorator';
import { clampPageParam, singleQueryValue } from '../common/pagination.util';

/**
 * Requests to follow the caller's private account.
 *
 * The subject is always the JWT: there is no route that reads or answers
 * another user's inbox, and `:userId` names the REQUESTER, never the target.
 * Same guard as the follow route itself, which has no further eligibility gate.
 */
@Controller('api/follow-requests')
@UseGuards(JwtGuard)
export class FollowRequestsController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  // The list is per-viewer and changes the moment a request is answered, so it
  // is revalidated every time (a 304 still saves the payload).
  @CacheControl('private, no-cache')
  async list(
    @Req() req: AuthenticatedRequest,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.usersService.listFollowRequests(
      req.user.id,
      clampPageParam(singleQueryValue(limit), { def: 20, min: 1, max: 50 }),
      singleQueryValue(cursor),
    );
  }

  @Post(':userId/accept')
  @HttpCode(HttpStatus.OK)
  async accept(
    @Param('userId', new ParseUUIDPipe()) requesterId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.usersService.acceptFollowRequest(req.user.id, requesterId);
  }

  @Post(':userId/decline')
  @HttpCode(HttpStatus.OK)
  async decline(
    @Param('userId', new ParseUUIDPipe()) requesterId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.usersService.declineFollowRequest(req.user.id, requesterId);
  }
}
