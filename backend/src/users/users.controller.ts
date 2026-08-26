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
import { UsersService } from './users.service';
import { JwtGuard } from '../common/guards/jwt.guard';
import { CacheControl } from '../common/decorators/cache-control.decorator';

@Controller('api/users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

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
    @Req() req: any,
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
    @Req() req: any,
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
    @Req() req: any,
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
  async getOnlineFriends(@Req() req: any, @Query('limit') limit?: string) {
    const limitNum = limit
      ? Math.min(Math.max(parseInt(limit, 10) || 6, 1), 20)
      : 6;
    return this.usersService.getOnlineFriends(req.user.id, limitNum);
  }

  @Get('campus')
  @UseGuards(JwtGuard)
  @CacheControl('private, no-cache')
  async getCampusUsers(
    @Req() req: any,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 100;
    const offsetNum = offset ? parseInt(offset, 10) : 0;
    return this.usersService.getCampusUsers(req.user.id, limitNum, offsetNum);
  }

  // Server-side campus directory: search + course/branch/currentYear, keyset pagination.
  // Registered before the catch-all `:username` route below.
  @Get('directory')
  @UseGuards(JwtGuard)
  @CacheControl('private, no-cache')
  async getDirectory(
    @Req() req: any,
    @Query('search') search?: string,
    @Query('course') course?: string,
    @Query('branch') branch?: string,
    @Query('year') year?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const currentYear =
      year && /^\d+$/.test(year) ? parseInt(year, 10) : undefined;
    const limitNum = limit
      ? Math.min(Math.max(parseInt(limit, 10) || 30, 1), 50)
      : 30;
    return this.usersService.getDirectory(req.user.id, {
      search: search || undefined,
      course: course && course !== 'All' ? course : undefined,
      branch: branch && branch !== 'All' ? branch : undefined,
      currentYear,
      limit: limitNum,
      cursor: cursor || undefined,
    });
  }

  @Get('id/:id')
  @UseGuards(JwtGuard)
  @CacheControl('private, no-cache')
  async getUserById(@Param('id') id: string, @Req() req: any) {
    return this.usersService.getUserById(id, req.user?.id);
  }

  @Patch('me')
  @UseGuards(JwtGuard)
  async updateProfile(@Req() req: any, @Body() data: any) {
    const currentUserId = req.user?.id;
    const userEmail = req.user?.email || req.user?.user_metadata?.email;
    return this.usersService.updateProfile(currentUserId, data, userEmail);
  }

  @Get('me/settings')
  @UseGuards(JwtGuard)
  async getSettings(@Req() req: any) {
    return this.usersService.getSettings(req.user.id);
  }

  @Patch('me/settings')
  @UseGuards(JwtGuard)
  async updateSettings(@Req() req: any, @Body() data: any) {
    return this.usersService.updateSettings(req.user.id, data);
  }

  @Get(':username')
  @UseGuards(JwtGuard)
  @CacheControl('private, no-cache')
  async getProfile(@Param('username') username: string, @Req() req: any) {
    const currentUserId = req.user?.id;
    return this.usersService.getProfileByUsername(username, currentUserId);
  }

  @Get(':username/followers')
  @UseGuards(JwtGuard)
  @CacheControl('private, no-cache')
  async getFollowers(
    @Param('username') username: string,
    @Req() req: any,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 50;
    const offsetNum = offset ? parseInt(offset, 10) : 0;
    return this.usersService.getFollowers(
      username,
      req.user?.id,
      limitNum,
      offsetNum,
    );
  }

  @Get(':username/following')
  @UseGuards(JwtGuard)
  @CacheControl('private, no-cache')
  async getFollowing(
    @Param('username') username: string,
    @Req() req: any,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 50;
    const offsetNum = offset ? parseInt(offset, 10) : 0;
    return this.usersService.getFollowing(
      username,
      req.user?.id,
      limitNum,
      offsetNum,
    );
  }

  @Post(':username/follow')
  @UseGuards(JwtGuard)
  async follow(@Param('username') username: string, @Req() req: any) {
    const currentUserId = req.user?.id;
    return this.usersService.followUser(currentUserId, username);
  }

  @Post(':username/unfollow')
  @UseGuards(JwtGuard)
  async unfollow(@Param('username') username: string, @Req() req: any) {
    const currentUserId = req.user?.id;
    return this.usersService.unfollowUser(currentUserId, username);
  }

  @Post('block/:targetUserId')
  @UseGuards(JwtGuard)
  async blockUser(
    @Param('targetUserId') targetUserId: string,
    @Req() req: any,
  ) {
    return this.usersService.blockUser(req.user.id, targetUserId);
  }

  @Delete('block/:targetUserId')
  @UseGuards(JwtGuard)
  async unblockUser(
    @Param('targetUserId') targetUserId: string,
    @Req() req: any,
  ) {
    return this.usersService.unblockUser(req.user.id, targetUserId);
  }
}
