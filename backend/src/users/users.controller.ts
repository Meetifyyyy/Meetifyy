import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
  Query,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';
import { UsersService } from './users.service';
import { AccountDeletionService } from '../account-deletion/account-deletion.service';
import { JwtGuard } from '../common/guards/jwt.guard';
import { CacheControl } from '../common/decorators/cache-control.decorator';
import { VerifiedOnly } from '../common/decorators/verified-only.decorator';
import { clampPageParam } from '../common/pagination.util';

@Controller('api/users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly accountDeletionService: AccountDeletionService,
  ) {}

  @Get()
  @UseGuards(JwtGuard)
  // No max-age: these payloads embed avatar/cover keys, and a browser HTTP
  // cache cannot be invalidated from JS — after changing a profile image the
  // refetch was served the stale cached body and the old image persisted until
  // the entry expired. `no-cache` still allows a conditional request, and the
  // ETag interceptor answers unchanged bodies with a 304, so this costs a
  // round-trip but not a payload. (Same reasoning as activities.controller.ts.)
  @CacheControl('private, no-cache')
  async getAllUsers(
    @Req() req: AuthenticatedRequest,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 20;
    const offsetNum = offset ? parseInt(offset, 10) : 0;
    return this.usersService.getAllUsers(limitNum, offsetNum, req.user?.id);
  }

  @Get('connections')
  @UseGuards(JwtGuard)
  @CacheControl('private, no-cache')
  async getConnections(
    @Req() req: AuthenticatedRequest,
    @Query('q') query?: string,
    @Query('limit') limit?: string,
  ) {
    const limitNum = limit ? Math.min(parseInt(limit, 10), 100) : 50;
    return this.usersService.getConnections(req.user.id, query, limitNum);
  }

  // NOTE: must stay registered before the catch-all `:username` route below,
  // or every request here would be swallowed as a profile lookup for the
  // literal username "mention-search".
  @Get('mention-search')
  @UseGuards(JwtGuard)
  async searchMentionCandidates(
    @Req() req: AuthenticatedRequest,
    @Query('q') query?: string,
    @Query('communityId') communityId?: string,
    @Query('limit') limit?: string,
  ) {
    const limitNum = limit
      ? Math.min(Math.max(parseInt(limit, 10) || 15, 1), 25)
      : 15;
    return this.usersService.getMentionSuggestions(
      req.user.id,
      query || '',
      communityId,
      limitNum,
    );
  }

  // NOTE: same route-ordering requirement as mention-search above.
  @Get('online-friends')
  @UseGuards(JwtGuard)
  @CacheControl('private, no-cache')
  async getOnlineFriends(
    @Req() req: AuthenticatedRequest,
    @Query('limit') limit?: string,
  ) {
    const limitNum = limit
      ? Math.min(Math.max(parseInt(limit, 10) || 6, 1), 20)
      : 6;
    return this.usersService.getOnlineFriends(req.user.id, limitNum);
  }

  // NOTE: same route-ordering requirement as mention-search above — this must
  // stay ahead of the catch-all `:username`.
  @Get('recommendations')
  @UseGuards(JwtGuard)
  // `no-cache` for the same reason as the listing above: the payload embeds
  // avatar keys AND per-viewer follow state, neither of which a browser HTTP
  // cache can be invalidated for from JS.
  @CacheControl('private, no-cache')
  async getFollowRecommendations(
    @Req() req: AuthenticatedRequest,
    @Query('limit') limit?: string,
  ) {
    const limitNum = clampPageParam(limit, { def: 10, max: 30, min: 1 });
    return this.usersService.getFollowRecommendations(req.user.id, limitNum);
  }

  // The campus surfaces are verification-gated. The frontend already renders a
  // locked page for them, but that gate wrapped only the JSX — the page's
  // queries still ran, so an unverified account fetched the whole campus
  // directory into its client cache and the lock was decoration. The read has
  // to be refused here for the restriction to mean anything.
  @Get('campus')
  @UseGuards(JwtGuard)
  @VerifiedOnly()
  @CacheControl('private, no-cache')
  async getCampusUsers(
    @Req() req: AuthenticatedRequest,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    // Default stays 100 — the value this endpoint has always used when the
    // caller omits it. Only the cap is new.
    const limitNum = clampPageParam(limit, { def: 100, max: 100, min: 1 });
    const offsetNum = clampPageParam(offset, { def: 0, max: 5000 });
    return this.usersService.getCampusUsers(req.user.id, limitNum, offsetNum);
  }

  // Server-side campus directory: search + course/branch/currentYear, keyset pagination.
  // Registered before the catch-all `:username` route below.
  @Get('directory')
  @UseGuards(JwtGuard)
  @VerifiedOnly()
  @CacheControl('private, no-cache')
  async getDirectory(
    @Req() req: AuthenticatedRequest,
    @Query('search') search?: string,
    @Query('course') course?: string,
    @Query('branch') branch?: string,
    @Query('year') year?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const passingYear =
      year && /^\d+$/.test(year) ? parseInt(year, 10) : undefined;
    const limitNum = limit
      ? Math.min(Math.max(parseInt(limit, 10) || 30, 1), 50)
      : 30;
    return this.usersService.getDirectory(req.user.id, {
      search: search || undefined,
      course: course && course !== 'All' ? course : undefined,
      branch: branch && branch !== 'All' ? branch : undefined,
      passingYear,
      limit: limitNum,
      cursor: cursor || undefined,
    });
  }

  @Get('id/:id')
  @UseGuards(JwtGuard)
  @CacheControl('private, no-cache')
  async getUserById(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.usersService.getUserById(id, req.user?.id);
  }

  @Patch('me')
  @UseGuards(JwtGuard)
  async updateProfile(@Req() req: AuthenticatedRequest, @Body() data: any) {
    const currentUserId = req.user?.id;
    // user_metadata is arbitrary JSON from the identity provider, so its
    // `email` is only usable once it has actually been checked to be a string.
    const metadataEmail = req.user?.user_metadata?.email;
    const userEmail =
      req.user?.email ??
      (typeof metadataEmail === 'string' ? metadataEmail : undefined);
    return this.usersService.updateProfile(currentUserId, data, userEmail);
  }

  @Get('me/settings')
  @UseGuards(JwtGuard)
  async getSettings(@Req() req: AuthenticatedRequest) {
    return this.usersService.getSettings(req.user.id);
  }

  @Patch('me/settings')
  @UseGuards(JwtGuard)
  async updateSettings(@Req() req: AuthenticatedRequest, @Body() data: any) {
    return this.usersService.updateSettings(req.user.id, data);
  }

  // NOTE: registered BEFORE the catch-all `:username` route so the literal
  // string "me" is never treated as a profile lookup.
  //
  // Kept as an alias rather than removed. It used to delete irreversibly and on
  // the spot; a client still holding the old bundle — a cached PWA shell, a
  // phone that has not refreshed — would otherwise keep hitting a route that
  // either no longer exists or, worse, still did the old thing.
  //
  // It now starts the OTP challenge instead of deleting. An old client will not
  // understand the response and will show an error, which is the correct
  // outcome: the alias must not be a way to skip the code, and failing visibly
  // beats deleting an account without confirmation.
  @Delete('me')
  @UseGuards(JwtGuard)
  async deleteAccount(@Req() req: AuthenticatedRequest) {
    return this.accountDeletionService.requestDeletionOtp(req.user.id, {
      ip:
        (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
        req.ip ||
        'unknown',
    });
  }

  @Get(':username')
  @UseGuards(JwtGuard)
  @CacheControl('private, no-cache')
  async getProfile(
    @Param('username') username: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const currentUserId = req.user?.id;
    return this.usersService.getProfileByUsername(username, currentUserId);
  }

  @Get(':username/followers')
  @UseGuards(JwtGuard)
  @CacheControl('private, no-cache')
  // `eligibleOnly=true` is passed by recipient pickers (Activity Invite), never
  // by the profile's follower/following viewer. See getFollowers in the service
  // for why one endpoint answers both questions.
  async getFollowers(
    @Param('username') username: string,
    @Req() req: AuthenticatedRequest,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('eligibleOnly') eligibleOnly?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 50;
    const offsetNum = offset ? parseInt(offset, 10) : 0;
    return this.usersService.getFollowers(
      username,
      req.user?.id,
      limitNum,
      offsetNum,
      eligibleOnly === 'true',
    );
  }

  @Get(':username/following')
  @UseGuards(JwtGuard)
  @CacheControl('private, no-cache')
  // `eligibleOnly=true` is passed by recipient pickers (Activity Invite), never
  // by the profile's follower/following viewer. See getFollowers in the service
  // for why one endpoint answers both questions.
  async getFollowing(
    @Param('username') username: string,
    @Req() req: AuthenticatedRequest,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('eligibleOnly') eligibleOnly?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 50;
    const offsetNum = offset ? parseInt(offset, 10) : 0;
    return this.usersService.getFollowing(
      username,
      req.user?.id,
      limitNum,
      offsetNum,
      eligibleOnly === 'true',
    );
  }

  @Post(':username/follow')
  @UseGuards(JwtGuard)
  @VerifiedOnly()
  async follow(
    @Param('username') username: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const currentUserId = req.user?.id;
    return this.usersService.followUser(currentUserId, username);
  }

  @Post(':username/unfollow')
  @UseGuards(JwtGuard)
  @VerifiedOnly()
  async unfollow(
    @Param('username') username: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const currentUserId = req.user?.id;
    return this.usersService.unfollowUser(currentUserId, username);
  }

  @Post('block/:targetUserId')
  @UseGuards(JwtGuard)
  async blockUser(
    @Param('targetUserId') targetUserId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.usersService.blockUser(req.user.id, targetUserId);
  }

  @Delete('block/:targetUserId')
  @UseGuards(JwtGuard)
  async unblockUser(
    @Param('targetUserId') targetUserId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.usersService.unblockUser(req.user.id, targetUserId);
  }
}
